package users

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/db"
)

func (s *Service) List(ctx context.Context) ([]User, error) {
	rows, err := s.db.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]User, 0, len(rows))
	for _, r := range rows {
		out = append(out, fromRow(db.User{
			ID: r.ID, Handle: r.Handle, Email: r.Email, Name: r.Name, Role: r.Role, CreatedAt: r.CreatedAt, LastSeenAt: r.LastSeenAt,
			MaxSessions: r.MaxSessions, MaxSessionTtl: r.MaxSessionTtl, RecordingsQuota: r.RecordingsQuota, AppDataQuota: r.AppDataQuota,
		}, r.Passkeys))
	}
	return out, nil
}

// Create adds a user without a passkey, for accounts that only ever sign in
// with a session minted by the holtdroid users session command (bots).
func (s *Service) Create(ctx context.Context, name, email, role string, limits Overrides) (User, error) {
	name, err := cleanName(name)
	if err != nil {
		return User{}, err
	}
	if email, err = s.checkEmail(email, nil); err != nil {
		return User{}, err
	}
	if !ValidRole(role) {
		return User{}, fmt.Errorf("%w: unknown role %q", ErrInvalid, role)
	}
	id := newUserID()
	err = s.db.Tx(ctx, func(q *db.Queries) error {
		if _, err := q.GetUserByEmail(ctx, email); err == nil {
			return ErrEmailTaken
		}
		if err := q.CreateUser(ctx, db.CreateUserParams{ID: id, Handle: randomBytes(32), Email: email, Name: name, Role: role, CreatedAt: s.now()}); err != nil {
			return err
		}
		return q.UpdateUser(ctx, db.UpdateUserParams{
			Email: email, Name: name, Role: role, MaxSessions: limits.MaxSessions, MaxSessionTtl: limits.MaxSessionTTL,
			RecordingsQuota: limits.RecordingsQuota, AppDataQuota: limits.AppDataMaxSize, ID: id,
		})
	})
	if err != nil {
		return User{}, err
	}
	return s.Get(ctx, id)
}

// IdentityFor is the signed-in identity of the user with email.
func (s *Service) IdentityFor(ctx context.Context, email string) (auth.Identity, error) {
	u, err := s.db.GetUserByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	if err != nil {
		return auth.Identity{}, fmt.Errorf("%w: no user with email %q", ErrNotFound, email)
	}
	return identity(u), nil
}

func (s *Service) Get(ctx context.Context, id string) (User, error) {
	u, err := s.db.GetUser(ctx, id)
	if err != nil {
		return User{}, notFound(err)
	}
	n, err := s.db.CountPasskeys(ctx, id)
	if err != nil {
		return User{}, err
	}
	return fromRow(u, n), nil
}

type Update struct {
	Name   string
	Email  string
	Role   string
	Limits Overrides
}

func (s *Service) Update(ctx context.Context, id string, in Update) (User, error) {
	name, err := cleanName(in.Name)
	if err != nil {
		return User{}, err
	}
	email, err := s.checkEmail(in.Email, nil)
	if err != nil {
		return User{}, err
	}
	if !ValidRole(in.Role) {
		return User{}, fmt.Errorf("%w: unknown role %q", ErrInvalid, in.Role)
	}
	for _, v := range []*int64{in.Limits.MaxSessions, in.Limits.MaxSessionTTL, in.Limits.RecordingsQuota, in.Limits.AppDataMaxSize} {
		if v != nil && *v < 0 {
			return User{}, fmt.Errorf("%w: limits can't be negative", ErrInvalid)
		}
	}
	err = s.db.Tx(ctx, func(q *db.Queries) error {
		u, err := q.GetUser(ctx, id)
		if err != nil {
			return notFound(err)
		}
		if u.Role == RoleAdmin && in.Role != RoleAdmin {
			if err := lastAdmin(ctx, q); err != nil {
				return err
			}
		}
		if other, err := q.GetUserByEmail(ctx, email); err == nil && other.ID != id {
			return ErrEmailTaken
		}
		return q.UpdateUser(ctx, db.UpdateUserParams{
			Email: email, Name: name, Role: in.Role, MaxSessions: in.Limits.MaxSessions, MaxSessionTtl: in.Limits.MaxSessionTTL,
			RecordingsQuota: in.Limits.RecordingsQuota, AppDataQuota: in.Limits.AppDataMaxSize, ID: id,
		})
	})
	if err != nil {
		return User{}, err
	}
	return s.Get(ctx, id)
}

func (s *Service) Delete(ctx context.Context, id string) error {
	return s.db.Tx(ctx, func(q *db.Queries) error {
		u, err := q.GetUser(ctx, id)
		if err != nil {
			return notFound(err)
		}
		if u.Role == RoleAdmin {
			if err := lastAdmin(ctx, q); err != nil {
				return err
			}
		}
		_, err = q.DeleteUser(ctx, id)
		return err
	})
}

func lastAdmin(ctx context.Context, q *db.Queries) error {
	n, err := q.CountAdmins(ctx)
	if err != nil {
		return err
	}
	if n <= 1 {
		return ErrLastAdmin
	}
	return nil
}

// IsUserError tells validation and state errors, safe to show, from
// internal ones.
func IsUserError(err error) bool {
	for _, e := range []error{ErrInvalid, ErrExpired, ErrEmailTaken, ErrLastPasskey, ErrLastAdmin, ErrNotFound} {
		if errors.Is(err, e) {
			return true
		}
	}
	return false
}
