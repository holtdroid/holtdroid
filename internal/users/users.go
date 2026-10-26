// Package users is the directory of the users auth mode: people, their
// passkeys, invite and recovery links, roles and limits, kept in the api's
// database.
package users

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base32"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/db"
)

const (
	RoleAdmin   = "admin"
	RoleUser    = "user"
	RolePending = ""

	KindInvite    = "invite"
	KindRecovery  = "recovery"
	KindBootstrap = "bootstrap"
)

var (
	ErrNotFound    = errors.New("not found")
	ErrInvalid     = errors.New("invalid")
	ErrExpired     = errors.New("this link has expired or was already used")
	ErrEmailTaken  = errors.New("a user with this email already exists")
	ErrLastPasskey = errors.New("the last passkey can't be removed; add another one first")
	ErrLastAdmin   = errors.New("the last admin can't be removed or demoted")
)

type Service struct {
	db     *db.DB
	wa     *webauthn.WebAuthn
	cfg    auth.UsersConfig
	origin string
	now    func() time.Time
	log    *slog.Logger
}

func New(d *db.DB, cfg auth.UsersConfig, publicURL string, now func() time.Time) (*Service, error) {
	u, err := url.Parse(publicURL)
	if err != nil || u.Host == "" {
		return nil, errors.New("auth: the users mode needs publicURL, the origin passkeys are bound to")
	}
	for _, role := range []string{cfg.OIDCRole} {
		if !ValidRole(role) {
			return nil, fmt.Errorf("auth.users.oidcRole: unknown role %q", role)
		}
	}
	for role := range cfg.Limits {
		if role != RoleAdmin && role != RoleUser {
			return nil, fmt.Errorf("auth.users.limits: unknown role %q", role)
		}
	}
	for i, d := range cfg.AllowedDomains {
		cfg.AllowedDomains[i] = strings.ToLower(strings.TrimSpace(d))
	}
	origin := u.Scheme + "://" + u.Host
	wa, err := webauthn.New(&webauthn.Config{RPID: u.Hostname(), RPDisplayName: "Holtdroid", RPOrigins: []string{origin}})
	if err != nil {
		return nil, fmt.Errorf("auth: passkeys: %w", err)
	}
	return &Service{db: d, wa: wa, cfg: cfg, origin: strings.TrimSuffix(publicURL, "/"), now: now, log: slog.Default().With("component", "users")}, nil
}

func ValidRole(role string) bool {
	return role == RoleAdmin || role == RoleUser || role == RolePending
}

type User struct {
	ID         string     `json:"id"`
	Email      string     `json:"email"`
	Name       string     `json:"name"`
	Role       string     `json:"role" enum:"admin,user," doc:"empty while waiting for approval"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastSeenAt *time.Time `json:"lastSeenAt,omitempty"`
	Passkeys   int64      `json:"passkeys"`
	Limits     Overrides  `json:"limits"`
}

// Overrides are a user's own limits; nil uses the role's or the server's.
type Overrides struct {
	MaxSessions     *int64 `json:"maxSessions,omitempty" doc:"0 for no limit"`
	MaxSessionTTL   *int64 `json:"maxSessionTTL,omitempty" doc:"seconds"`
	RecordingsQuota *int64 `json:"recordingsQuota,omitempty" doc:"bytes, 0 for no limit"`
	AppDataMaxSize  *int64 `json:"appDataMaxSize,omitempty" doc:"bytes"`
	ReferencesQuota *int64 `json:"referencesQuota,omitempty" doc:"bytes of pixel perfect references, 0 for no limit"`
}

func fromRow(u db.User, passkeys int64) User {
	return User{
		ID: u.ID, Email: u.Email, Name: u.Name, Role: u.Role, CreatedAt: u.CreatedAt, LastSeenAt: u.LastSeenAt, Passkeys: passkeys,
		Limits: Overrides{
			MaxSessions: u.MaxSessions, MaxSessionTTL: u.MaxSessionTtl, RecordingsQuota: u.RecordingsQuota, AppDataMaxSize: u.AppDataQuota,
			ReferencesQuota: u.ReferencesQuota,
		},
	}
}

func identity(u db.User) auth.Identity {
	return auth.Identity{User: u.ID, Name: u.Name, Email: u.Email, Groups: []string{}, Admin: u.Role == RoleAdmin, Pending: u.Role == RolePending}
}

const touchEvery = 5 * time.Minute

// Lookup implements auth.Directory.
func (s *Service) Lookup(ctx context.Context, id string) (auth.Identity, error) {
	u, err := s.db.GetUser(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return auth.Identity{}, auth.ErrUnauthenticated
	}
	if err != nil {
		return auth.Identity{}, err
	}
	if now := s.now(); u.LastSeenAt == nil || now.Sub(*u.LastSeenAt) > touchEvery {
		if err := s.db.TouchUser(ctx, db.TouchUserParams{LastSeenAt: &now, ID: id}); err != nil {
			s.log.Warn("could not record last seen", "user", id, "err", err)
		}
	}
	return identity(u), nil
}

// SignInOIDC implements auth.Directory: the identity provider's verified
// email finds the user; an unknown one signs up with auth.users.oidcRole, or
// as admin when the provider says so.
func (s *Service) SignInOIDC(ctx context.Context, id auth.Identity, admin bool) (auth.Identity, error) {
	email, err := s.checkEmail(id.Email, nil)
	if err != nil {
		return auth.Identity{}, fmt.Errorf("%w: %w", auth.ErrForbidden, err)
	}
	u, err := s.db.GetUserByEmail(ctx, email)
	if err == nil {
		return identity(u), nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return auth.Identity{}, err
	}
	role := s.cfg.OIDCRole
	if admin {
		role = RoleAdmin
	}
	u = db.User{ID: newUserID(), Handle: randomBytes(32), Email: email, Name: cmpOr(id.Name, id.User, email), Role: role, CreatedAt: s.now()}
	if err := s.db.CreateUser(ctx, db.CreateUserParams{ID: u.ID, Handle: u.Handle, Email: u.Email, Name: u.Name, Role: u.Role, CreatedAt: u.CreatedAt}); err != nil {
		return auth.Identity{}, err
	}
	return identity(u), nil
}

// Limits returns the limits of a user's role from auth.users.limits and the
// user's own overrides, which win even when zero.
func (s *Service) Limits(ctx context.Context, id string) (auth.Limits, Overrides, bool) {
	u, err := s.db.GetUser(ctx, id)
	if err != nil {
		return auth.Limits{}, Overrides{}, false
	}
	return s.cfg.Limits[u.Role], fromRow(u, 0).Limits, true
}

func (s *Service) Name(ctx context.Context, id string) string {
	u, err := s.db.GetUser(ctx, id)
	if err != nil {
		return ""
	}
	return u.Name
}

func (s *Service) checkEmail(raw string, inviteDomains []string) (string, error) {
	addr, err := mail.ParseAddress(strings.TrimSpace(raw))
	if err != nil || addr.Name != "" || !strings.Contains(addr.Address, "@") {
		return "", fmt.Errorf("%w: enter a valid email address", ErrInvalid)
	}
	email := strings.ToLower(addr.Address)
	domain := email[strings.LastIndex(email, "@")+1:]
	for _, allowed := range [][]string{s.cfg.AllowedDomains, inviteDomains} {
		if len(allowed) > 0 && !slices.Contains(allowed, domain) {
			return "", fmt.Errorf("%w: only addresses at %s may sign up", ErrInvalid, strings.Join(allowed, ", "))
		}
	}
	return email, nil
}

func cleanName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 {
		return "", fmt.Errorf("%w: a name of 1 to 100 characters is required", ErrInvalid)
	}
	return name, nil
}

var lowerBase32 = base32.StdEncoding.WithPadding(base32.NoPadding)

func newUserID() string { return "u" + strings.ToLower(lowerBase32.EncodeToString(randomBytes(8))) }

func randomBytes(n int) []byte {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return b
}

func newToken() (token string, hash []byte) {
	token = base64.RawURLEncoding.EncodeToString(randomBytes(24))
	return token, hashToken(token)
}

func hashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

func cmpOr(vals ...string) string {
	for _, v := range vals {
		if v = strings.TrimSpace(v); v != "" {
			return v
		}
	}
	return ""
}
