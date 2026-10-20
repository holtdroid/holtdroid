package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/holtdroid/holtdroid/internal/secrets"
)

const (
	ModeAnonymous = "anonymous"
	ModePassword  = "password"
	ModeOIDC      = "oidc"
	ModeHeader    = "header"
	ModeNone      = "none"
)

type Identity struct {
	User    string   `json:"user"`
	Name    string   `json:"name,omitempty"`
	Email   string   `json:"email,omitempty"`
	Picture string   `json:"picture,omitempty" doc:"Avatar URL from the identity provider; the UI generates one from user when empty"`
	Groups  []string `json:"groups"`
	Admin   bool     `json:"admin"`
}

type HeaderConfig struct {
	User    string
	Groups  string
	Name    string
	Email   string
	Picture string
}

type OIDCConfig struct {
	Issuer        string
	ClientID      string
	ClientSecret  secrets.Ref
	Scopes        []string
	UsernameClaim string
	GroupsClaim   string
	PictureClaim  string
	RedirectURL   string
}

type Config struct {
	Mode          string
	SessionKey    secrets.Ref
	SessionTTL    time.Duration
	CookieName    string
	Password      secrets.Ref
	OIDC          OIDCConfig
	Header        HeaderConfig
	AllowedGroups []string
	AdminGroups   []string
}

func DefaultConfig() Config {
	return Config{
		Mode:       ModeAnonymous,
		SessionTTL: 30 * 24 * time.Hour,
		CookieName: "holtdroid_session",
		OIDC: OIDCConfig{
			Scopes:        []string{"openid", "profile", "email", "groups"},
			UsernameClaim: "preferred_username",
			GroupsClaim:   "groups",
			PictureClaim:  "picture",
		},
		Header: HeaderConfig{User: "Remote-User", Groups: "Remote-Groups", Name: "Remote-Name", Email: "Remote-Email"},
	}
}

var (
	ErrUnauthenticated = errors.New("unauthenticated")
	ErrForbidden       = errors.New("forbidden")
	ErrBadPassword     = errors.New("wrong password")
)

// Authenticator identifies requests. Cookie-based modes (anonymous, password,
// oidc) keep everything in a signed JWT, so any api replica can verify it.
type Authenticator struct {
	cfg      Config
	key      []byte
	password string
	secure   bool
	oidc     *oidcClient
	now      func() time.Time
	log      *slog.Logger

	OnSignIn func(ctx context.Context, method string, id Identity, err error)
	// Bearer resolves an Authorization: Bearer token, for clients that
	// don't hold a session cookie (the holtdroid client). Nil turns
	// bearer tokens off.
	Bearer func(token string) (Identity, error)
}

func (a *Authenticator) bearer(r *http.Request) (Identity, bool, error) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || a.Bearer == nil {
		return Identity{}, false, nil
	}
	id, err := a.Bearer(strings.TrimSpace(token))
	if err != nil {
		return Identity{}, true, ErrUnauthenticated
	}
	id, err = a.authorize(id)
	return id, true, err
}

func New(ctx context.Context, cfg Config, reg *secrets.Registry, publicURL string) (*Authenticator, error) {
	a := &Authenticator{
		cfg:    cfg,
		secure: strings.HasPrefix(publicURL, "https://"),
		now:    time.Now,
		log:    slog.Default().With("component", "auth"),
	}
	if a.cfg.CookieName == "" {
		a.cfg.CookieName = "holtdroid_session"
	}
	if a.cfg.SessionTTL <= 0 {
		a.cfg.SessionTTL = 30 * 24 * time.Hour
	}

	switch cfg.Mode {
	case ModeHeader:
		if cfg.Header.User == "" {
			return nil, errors.New("auth: header.user is required for the header mode")
		}
		return a, nil
	case ModeNone:
		return a, nil
	case ModeAnonymous, ModePassword, ModeOIDC:
	default:
		return nil, fmt.Errorf("auth: unknown mode %q", cfg.Mode)
	}

	if cfg.SessionKey.IsZero() {
		a.key = make([]byte, 32)
		_, _ = rand.Read(a.key)
		a.log.Warn("auth.sessionKey is not set: using a random key, sign-ins won't survive restarts or work across replicas")
	} else {
		key, err := reg.Resolve(ctx, cfg.SessionKey)
		if err != nil {
			return nil, fmt.Errorf("auth.sessionKey: %w", err)
		}
		if len(key) < 32 {
			return nil, errors.New("auth.sessionKey must be at least 32 bytes")
		}
		a.key = []byte(key)
	}

	switch cfg.Mode {
	case ModePassword:
		if cfg.Password.IsZero() {
			return nil, errors.New("auth.password is required for the password mode")
		}
		pw, err := reg.Resolve(ctx, cfg.Password)
		if err != nil {
			return nil, fmt.Errorf("auth.password: %w", err)
		}
		if pw == "" {
			return nil, errors.New("auth.password must not be empty")
		}
		a.password = pw
	case ModeOIDC:
		client, err := newOIDCClient(ctx, cfg.OIDC, reg, publicURL)
		if err != nil {
			return nil, err
		}
		a.oidc = client
	}
	return a, nil
}

func (a *Authenticator) Mode() string { return a.cfg.Mode }

// Pseudonym is a stable name for user that doesn't reveal it, keyed with the
// session key in the cookie-based modes. In the header and none modes there
// is no key, so it is a plain hash.
func (a *Authenticator) Pseudonym(user string) string {
	mac := hmac.New(sha256.New, a.key)
	mac.Write([]byte("pseudonym\x00" + user))
	return strings.ToLower(base32.StdEncoding.EncodeToString(mac.Sum(nil)[:10]))
}

func (a *Authenticator) cookieBased() bool {
	return a.cfg.Mode == ModeAnonymous || a.cfg.Mode == ModePassword || a.cfg.Mode == ModeOIDC
}

type sessionClaims struct {
	jwt.RegisteredClaims
	Name    string   `json:"name,omitempty"`
	Email   string   `json:"email,omitempty"`
	Picture string   `json:"picture,omitempty"`
	Groups  []string `json:"groups,omitempty"`
	Mode    string   `json:"mode"`
}

const issuer = "holtdroid"

// Identify returns the caller's identity without side effects.
func (a *Authenticator) Identify(r *http.Request) (Identity, error) {
	if id, ok, err := a.bearer(r); ok {
		return id, err
	}
	switch a.cfg.Mode {
	case ModeNone:
		return Identity{User: "local", Name: "Local user", Groups: []string{}, Admin: true}, nil
	case ModeHeader:
		return a.fromHeaders(r)
	}
	id, _, err := a.fromCookie(r)
	return id, err
}

func (a *Authenticator) fromHeaders(r *http.Request) (Identity, error) {
	h := a.cfg.Header
	user := strings.TrimSpace(r.Header.Get(h.User))
	if user == "" {
		return Identity{}, ErrUnauthenticated
	}
	id := Identity{User: user, Groups: []string{}}
	if h.Groups != "" {
		for g := range strings.SplitSeq(r.Header.Get(h.Groups), ",") {
			if g = strings.TrimSpace(g); g != "" {
				id.Groups = append(id.Groups, g)
			}
		}
	}
	if h.Name != "" {
		id.Name = r.Header.Get(h.Name)
	}
	if h.Email != "" {
		id.Email = r.Header.Get(h.Email)
	}
	if h.Picture != "" {
		id.Picture = r.Header.Get(h.Picture)
	}
	return a.authorize(id)
}

func (a *Authenticator) authorize(id Identity) (Identity, error) {
	if id.Groups == nil {
		id.Groups = []string{}
	}
	id.Picture = safePicture(id.Picture)
	if len(a.cfg.AllowedGroups) > 0 && a.cfg.Mode != ModeAnonymous && a.cfg.Mode != ModePassword &&
		!intersects(id.Groups, a.cfg.AllowedGroups) {
		return Identity{User: id.User}, ErrForbidden
	}
	id.Admin = intersects(id.Groups, a.cfg.AdminGroups)
	return id, nil
}

func (a *Authenticator) fromCookie(r *http.Request) (Identity, time.Time, error) {
	c, err := r.Cookie(a.cfg.CookieName)
	if err != nil || c.Value == "" {
		return Identity{}, time.Time{}, ErrUnauthenticated
	}
	var claims sessionClaims
	_, err = jwt.ParseWithClaims(c.Value, &claims, func(*jwt.Token) (any, error) { return a.key, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(issuer),
		jwt.WithExpirationRequired(),
		jwt.WithTimeFunc(a.now),
	)
	if err != nil || claims.Mode != a.cfg.Mode || claims.Subject == "" {
		return Identity{}, time.Time{}, ErrUnauthenticated
	}
	id, err := a.authorize(Identity{User: claims.Subject, Name: claims.Name, Email: claims.Email, Picture: claims.Picture, Groups: claims.Groups})
	if err != nil {
		return Identity{}, time.Time{}, err
	}
	issued := time.Time{}
	if claims.IssuedAt != nil {
		issued = claims.IssuedAt.Time
	}
	return id, issued, nil
}

// SessionCookie signs id into a session cookie.
func (a *Authenticator) SessionCookie(id Identity) (*http.Cookie, error) {
	now := a.now()
	claims := sessionClaims{
		Issuer:    issuer,
		Subject:   id.User,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(a.cfg.SessionTTL)),
		Name:      id.Name,
		Email:     id.Email,
		Picture:   id.Picture,
		Groups:    id.Groups,
		Mode:      a.cfg.Mode,
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(a.key)
	if err != nil {
		return nil, err
	}
	return a.cookie(a.cfg.CookieName, signed, "/", a.cfg.SessionTTL), nil
}

func (a *Authenticator) cookie(name, value, path string, maxAge time.Duration) *http.Cookie {
	return &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     path,
		MaxAge:   int(maxAge.Seconds()),
		HttpOnly: true,
		Secure:   a.secure,
		SameSite: http.SameSiteLaxMode,
	}
}

// ClearCookie returns a cookie that removes the session.
func (a *Authenticator) ClearCookie() *http.Cookie {
	c := a.cookie(a.cfg.CookieName, "", "/", 0)
	c.MaxAge = -1
	return c
}

// Anonymous returns a fresh random identity for the anonymous mode.
func (a *Authenticator) Anonymous() (Identity, bool) {
	if a.cfg.Mode != ModeAnonymous {
		return Identity{}, false
	}
	id, _ := a.authorize(Identity{User: RandomName()})
	return id, true
}

// Login checks the shared password and returns a new random identity.
func (a *Authenticator) Login(password string) (Identity, error) {
	if a.cfg.Mode != ModePassword {
		return Identity{}, fmt.Errorf("%w: password sign-in is not enabled", ErrForbidden)
	}
	if subtle.ConstantTimeCompare([]byte(password), []byte(a.password)) != 1 {
		time.Sleep(500 * time.Millisecond)
		return Identity{}, ErrBadPassword
	}
	id, _ := a.authorize(Identity{User: RandomName()})
	return id, nil
}

// Middleware rejects unauthenticated requests. In the anonymous mode it signs
// newcomers in with a random name instead, and it refreshes cookie sessions
// past half their lifetime.
func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var (
			id     Identity
			issued time.Time
			err    error
		)
		id, viaBearer, err := a.bearer(r)
		switch {
		case viaBearer:
		case a.cookieBased():
			id, issued, err = a.fromCookie(r)
		default:
			id, err = a.Identify(r)
		}

		if errors.Is(err, ErrUnauthenticated) && !viaBearer {
			if anon, ok := a.Anonymous(); ok {
				id, err, issued = anon, nil, time.Time{}
			}
		}
		switch {
		case errors.Is(err, ErrForbidden):
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		case err != nil:
			http.Error(w, "unauthenticated", http.StatusUnauthorized)
			return
		}

		if !viaBearer && a.cookieBased() && a.now().Sub(issued) > a.cfg.SessionTTL/2 {
			if c, err := a.SessionCookie(id); err == nil {
				http.SetCookie(w, c)
			}
		}
		next.ServeHTTP(w, r.WithContext(WithIdentity(r.Context(), id)))
	})
}

// safePicture keeps only absolute http(s) URLs, so a claim can never smuggle a
// javascript: or data: URL into an <img>.
func safePicture(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || len(raw) > 2048 {
		return ""
	}
	return u.String()
}

func intersects(a, b []string) bool {
	return slices.ContainsFunc(a, func(s string) bool { return slices.Contains(b, s) })
}

type ctxKey struct{}

func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

func FromContext(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(ctxKey{}).(Identity)
	return id, ok
}

// Optional attaches the caller's identity when there is a valid one and never
// rejects; used for the sign-in endpoints themselves.
func (a *Authenticator) Optional(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id, err := a.Identify(r); err == nil {
			r = r.WithContext(WithIdentity(r.Context(), id))
		}
		next.ServeHTTP(w, r)
	})
}
