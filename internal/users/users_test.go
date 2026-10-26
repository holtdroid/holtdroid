package users

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/db"
)

func newService(t *testing.T, cfg auth.UsersConfig) *Service {
	t.Helper()
	d, err := db.Open(context.Background(), db.DefaultConfig(), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	s, err := New(d, cfg, "https://holtdroid.test", func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSignInOIDC(t *testing.T) {
	ctx := context.Background()
	s := newService(t, auth.UsersConfig{AllowedDomains: []string{"Example.com"}})

	for _, tc := range []struct {
		name        string
		id          auth.Identity
		admin       bool
		wantErr     error
		wantPending bool
		wantAdmin   bool
	}{
		{name: "no email", id: auth.Identity{User: "x"}, wantErr: auth.ErrForbidden},
		{name: "other domain", id: auth.Identity{User: "x", Email: "x@evil.test"}, wantErr: auth.ErrForbidden},
		{name: "new user waits", id: auth.Identity{User: "ann", Email: "ann@example.com"}, wantPending: true},
		{name: "same email, same user", id: auth.Identity{User: "ann2", Email: "ANN@example.com"}, admin: true, wantPending: true},
		{name: "admin group", id: auth.Identity{User: "root", Name: "Root", Email: "root@example.com"}, admin: true, wantAdmin: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			id, err := s.SignInOIDC(ctx, tc.id, tc.admin)
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("err = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if id.Pending != tc.wantPending || id.Admin != tc.wantAdmin || id.User == tc.id.User {
				t.Fatalf("identity = %+v", id)
			}
		})
	}
	list, err := s.List(ctx)
	if err != nil || len(list) != 2 {
		t.Fatalf("users = %+v, %v", list, err)
	}
}

func TestInviteRules(t *testing.T) {
	ctx := context.Background()
	s := newService(t, auth.UsersConfig{AllowedDomains: []string{"example.com"}})
	for _, tc := range []struct {
		name    string
		in      NewInvite
		wantErr bool
	}{
		{name: "pending role", in: NewInvite{Role: RolePending, TTL: time.Hour, SingleUse: true}},
		{name: "domain inside allowed", in: NewInvite{Role: RoleUser, Domains: []string{"@Example.com"}}},
		{name: "domain outside allowed", in: NewInvite{Role: RoleUser, Domains: []string{"other.org"}}, wantErr: true},
		{name: "not a domain", in: NewInvite{Role: RoleUser, Domains: []string{"nodot"}}, wantErr: true},
		{name: "unknown role", in: NewInvite{Role: "owner"}, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			inv, link, err := s.CreateInvite(ctx, tc.in)
			if tc.wantErr {
				if !errors.Is(err, ErrInvalid) {
					t.Fatalf("err = %v", err)
				}
				return
			}
			if err != nil || link == "" || inv.Role != tc.in.Role {
				t.Fatalf("invite = %+v %q %v", inv, link, err)
			}
		})
	}
	_, link, _ := s.CreateInvite(ctx, NewInvite{Role: RoleUser, TTL: time.Hour})
	s.now = func() time.Time { return time.Date(2026, 1, 1, 13, 0, 0, 0, time.UTC) }
	if _, err := s.InviteInfo(ctx, link[len("https://holtdroid.test/invite/"):]); !errors.Is(err, ErrExpired) {
		t.Fatalf("expired invite: %v", err)
	}
}
