package users

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/holtdroid/holtdroid/internal/db"
)

type Invite struct {
	ID        string     `json:"id"`
	Role      string     `json:"role" enum:"admin,user," doc:"empty: the new user waits for approval"`
	Domains   []string   `json:"domains" doc:"email domains allowed on top of auth.users.allowedDomains; empty for any"`
	Note      string     `json:"note"`
	SingleUse bool       `json:"singleUse"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	Uses      int64      `json:"uses"`
	CreatedBy string     `json:"createdBy"`
	CreatedAt time.Time  `json:"createdAt"`
}

// InviteInfo is what someone opening a link sees before registering.
type InviteInfo struct {
	Kind    string   `json:"kind" enum:"invite,recovery,bootstrap"`
	Role    string   `json:"role" enum:"admin,user,"`
	Domains []string `json:"domains" doc:"allowed email domains, from the server and the invite"`
	Name    string   `json:"name,omitempty" doc:"the user a recovery link is for"`
	Email   string   `json:"email,omitempty"`
}

type NewInvite struct {
	Role      string
	Domains   []string
	Note      string
	SingleUse bool
	TTL       time.Duration
	CreatedBy string
}

func toInvite(r db.Invite) Invite {
	return Invite{
		ID: r.ID, Role: r.Role, Domains: splitDomains(r.Domains), Note: r.Note, SingleUse: r.SingleUse, ExpiresAt: r.ExpiresAt,
		Uses: r.Uses, CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt,
	}
}

func splitDomains(s string) []string {
	out := []string{}
	for d := range strings.SplitSeq(s, ",") {
		if d = strings.TrimSpace(d); d != "" {
			out = append(out, d)
		}
	}
	return out
}

// Link is the URL a token is opened at.
func (s *Service) Link(token string) string { return s.origin + "/invite/" + token }

func (s *Service) Invites(ctx context.Context) ([]Invite, error) {
	rows, err := s.db.ListInvites(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Invite, 0, len(rows))
	for _, r := range rows {
		out = append(out, toInvite(r))
	}
	return out, nil
}

// CreateInvite returns the invite and its link; only a hash of the token is
// stored, so the link can't be shown again.
func (s *Service) CreateInvite(ctx context.Context, in NewInvite) (Invite, string, error) {
	if !ValidRole(in.Role) {
		return Invite{}, "", fmt.Errorf("%w: unknown role %q", ErrInvalid, in.Role)
	}
	domains := make([]string, 0, len(in.Domains))
	for _, d := range in.Domains {
		d = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(d, "@")))
		if d == "" {
			continue
		}
		if strings.ContainsAny(d, ", @") || !strings.Contains(d, ".") {
			return Invite{}, "", fmt.Errorf("%w: %q is not a domain", ErrInvalid, d)
		}
		if len(s.cfg.AllowedDomains) > 0 && !slices.Contains(s.cfg.AllowedDomains, d) {
			return Invite{}, "", fmt.Errorf("%w: %s is not in auth.users.allowedDomains", ErrInvalid, d)
		}
		domains = append(domains, d)
	}
	return s.createLink(ctx, s.db.Queries, KindInvite, in.Role, nil, strings.Join(domains, ","), in.Note, in.SingleUse, in.TTL, in.CreatedBy)
}

func (s *Service) createLink(ctx context.Context, q *db.Queries, kind, role string, user *string, domains, note string, single bool, ttl time.Duration, by string) (Invite, string, error) {
	token, hash := newToken()
	now := s.now()
	var expires *time.Time
	if ttl > 0 {
		t := now.Add(ttl)
		expires = &t
	}
	if len(note) > 200 {
		note = note[:200]
	}
	row := db.CreateInviteParams{
		ID: strings.ToLower(lowerBase32.EncodeToString(randomBytes(6))), TokenHash: hash, Kind: kind, Role: role, UserID: user,
		Domains: domains, Note: strings.TrimSpace(note), SingleUse: single, ExpiresAt: expires, CreatedBy: by, CreatedAt: now,
	}
	if err := q.CreateInvite(ctx, row); err != nil {
		return Invite{}, "", err
	}
	return toInvite(db.Invite{
		ID: row.ID, Kind: kind, Role: role, UserID: user, Domains: domains, Note: row.Note, SingleUse: single, ExpiresAt: expires,
		CreatedBy: by, CreatedAt: now,
	}), s.Link(token), nil
}

func (s *Service) DeleteInvite(ctx context.Context, id string) error {
	n, err := s.db.DeleteInvite(ctx, id)
	if err == nil && n == 0 {
		err = ErrNotFound
	}
	return err
}

func (s *Service) validInvite(ctx context.Context, q *db.Queries, token string) (db.Invite, error) {
	inv, err := q.GetInviteByHash(ctx, hashToken(token))
	if err != nil {
		return db.Invite{}, ErrExpired
	}
	if (inv.ExpiresAt != nil && !s.now().Before(*inv.ExpiresAt)) || (inv.SingleUse && inv.Uses > 0) {
		return db.Invite{}, ErrExpired
	}
	return inv, nil
}

func (s *Service) InviteInfo(ctx context.Context, token string) (InviteInfo, error) {
	inv, err := s.validInvite(ctx, s.db.Queries, token)
	if err != nil {
		return InviteInfo{}, err
	}
	info := InviteInfo{Kind: inv.Kind, Role: inv.Role, Domains: splitDomains(inv.Domains)}
	if len(info.Domains) == 0 {
		info.Domains = append([]string{}, s.cfg.AllowedDomains...)
	}
	if inv.Kind == KindRecovery {
		u, err := s.db.GetUser(ctx, *inv.UserID)
		if err != nil {
			return InviteInfo{}, ErrExpired
		}
		info.Name, info.Email = u.Name, u.Email
	}
	return info, nil
}

// RecoveryLink lets user register a new passkey, e.g. after losing theirs.
// Earlier recovery links for the same user stop working.
func (s *Service) RecoveryLink(ctx context.Context, user string, ttl time.Duration, by string) (string, time.Time, error) {
	if ttl <= 0 || ttl > 30*24*time.Hour {
		return "", time.Time{}, fmt.Errorf("%w: a recovery link lasts up to 30 days", ErrInvalid)
	}
	var link string
	var inv Invite
	err := s.db.Tx(ctx, func(q *db.Queries) error {
		u, err := q.GetUser(ctx, user)
		if err != nil {
			return notFound(err)
		}
		if err := q.DeleteRecoveryLinks(ctx, &u.ID); err != nil {
			return err
		}
		inv, link, err = s.createLink(ctx, q, KindRecovery, u.Role, &u.ID, "", "", true, ttl, by)
		return err
	})
	if err != nil {
		return "", time.Time{}, err
	}
	return link, *inv.ExpiresAt, nil
}

// RecoveryLinkFor is RecoveryLink by email, for admins locked out of the
// portal (the holtdroid users recover command).
func (s *Service) RecoveryLinkFor(ctx context.Context, email string, ttl time.Duration, by string) (string, time.Time, error) {
	u, err := s.db.GetUserByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("%w: no user with email %q", ErrNotFound, email)
	}
	return s.RecoveryLink(ctx, u.ID, ttl, by)
}

const bootstrapTTL = 24 * time.Hour

// Bootstrap returns a single-use admin invite while there is no admin, so the
// first one can sign up. Each call replaces the previous link.
func (s *Service) Bootstrap(ctx context.Context) (string, bool, error) {
	n, err := s.db.CountAdmins(ctx)
	if err != nil || n > 0 {
		return "", false, err
	}
	var link string
	err = s.db.Tx(ctx, func(q *db.Queries) error {
		if err := q.DeleteBootstrapInvites(ctx); err != nil {
			return err
		}
		_, link, err = s.createLink(ctx, q, KindBootstrap, RoleAdmin, nil, "", "first admin", true, bootstrapTTL, "")
		return err
	})
	if err != nil {
		return "", false, errors.Join(errors.New("users: bootstrap invite"), err)
	}
	return link, true, nil
}
