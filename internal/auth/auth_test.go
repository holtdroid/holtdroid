package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/kriakiku/holtdroid/internal/secrets"
)

const testKey = "0123456789abcdef0123456789abcdef"

func newAuth(t *testing.T, mutate func(*Config)) *Authenticator {
	t.Helper()
	t.Setenv("TEST_SESSION_KEY", testKey)
	t.Setenv("TEST_PASSWORD", "hunter2")
	cfg := DefaultConfig()
	cfg.SessionKey = "env:TEST_SESSION_KEY"
	cfg.Password = "env:TEST_PASSWORD"
	mutate(&cfg)
	a, err := New(context.Background(), cfg, secrets.NewRegistry(), "https://android.example.com")
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func echo(a *Authenticator) http.Handler {
	return a.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, _ := FromContext(r.Context())
		_, _ = w.Write([]byte(id.User))
	}))
}

func withCookie(r *http.Request, c *http.Cookie) *http.Request {
	r.AddCookie(&http.Cookie{Name: c.Name, Value: c.Value})
	return r
}

func TestRandomName(t *testing.T) {
	re := regexp.MustCompile(`^[a-z]+-[a-z]+-[a-z]+$`)
	for range 50 {
		if n := RandomName(); !re.MatchString(n) {
			t.Fatalf("bad name %q", n)
		}
	}
}

func TestHeaderMode(t *testing.T) {
	a := newAuth(t, func(c *Config) {
		c.Mode = ModeHeader
		c.AllowedGroups = []string{"users", "admins"}
		c.AdminGroups = []string{"admins"}
	})
	tests := []struct {
		name    string
		headers map[string]string
		want    Identity
		wantErr error
	}{
		{name: "missing user", headers: map[string]string{}, wantErr: ErrUnauthenticated},
		{name: "not allowed", headers: map[string]string{"Remote-User": "eve", "Remote-Groups": "guests"}, wantErr: ErrForbidden},
		{
			name:    "user",
			headers: map[string]string{"Remote-User": "otter", "Remote-Groups": "users, dev", "Remote-Name": "Otter"},
			want:    Identity{User: "otter", Name: "Otter", Groups: []string{"users", "dev"}},
		},
		{
			name:    "admin",
			headers: map[string]string{"Remote-User": "root", "Remote-Groups": "admins"},
			want:    Identity{User: "root", Groups: []string{"admins"}, Admin: true},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			for k, v := range tt.headers {
				r.Header.Set(k, v)
			}
			got, err := a.Identify(r)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
			if tt.wantErr == nil && !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestAnonymousMode(t *testing.T) {
	a := newAuth(t, func(c *Config) { c.Mode = ModeAnonymous })
	h := echo(a)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/me", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || !cookies[0].Secure {
		t.Fatalf("expected one secure HttpOnly cookie, got %+v", cookies)
	}
	name := rec.Body.String()

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, withCookie(httptest.NewRequest(http.MethodGet, "/", nil), cookies[0]))
	if rec.Body.String() != name {
		t.Fatalf("identity not kept: %q != %q", rec.Body.String(), name)
	}
	if len(rec.Result().Cookies()) != 0 {
		t.Fatal("fresh session should not be re-issued")
	}

	a.now = func() time.Time { return time.Now().Add(20 * 24 * time.Hour) }
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, withCookie(httptest.NewRequest(http.MethodGet, "/", nil), cookies[0]))
	if rec.Body.String() != name || len(rec.Result().Cookies()) != 1 {
		t.Fatal("session past half its TTL should be refreshed with the same name")
	}
}

func TestPasswordMode(t *testing.T) {
	a := newAuth(t, func(c *Config) { c.Mode = ModePassword })
	h := echo(a)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no cookie: %d", rec.Code)
	}
	if _, err := a.Login("nope"); !errors.Is(err, ErrBadPassword) {
		t.Fatalf("wrong password: %v", err)
	}
	id, err := a.Login("hunter2")
	if err != nil {
		t.Fatal(err)
	}
	c, _ := a.SessionCookie(id)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, withCookie(httptest.NewRequest(http.MethodGet, "/", nil), c))
	if rec.Code != http.StatusOK || rec.Body.String() != id.User {
		t.Fatalf("with cookie: %d %q", rec.Code, rec.Body.String())
	}

	other := newAuth(t, func(c *Config) { c.Mode = ModeAnonymous })
	if _, err := other.Identify(withCookie(httptest.NewRequest(http.MethodGet, "/", nil), c)); err == nil {
		t.Fatal("cookie from another mode must be rejected")
	}

	tampered := *c
	tampered.Value = strings.Replace(c.Value, ".", ".x", 1)
	if _, err := a.Identify(withCookie(httptest.NewRequest(http.MethodGet, "/", nil), &tampered)); err == nil {
		t.Fatal("tampered cookie accepted")
	}

	a.now = func() time.Time { return time.Now().Add(31 * 24 * time.Hour) }
	if _, err := a.Identify(withCookie(httptest.NewRequest(http.MethodGet, "/", nil), c)); err == nil {
		t.Fatal("expired cookie accepted")
	}
}

func TestNoneMode(t *testing.T) {
	a := newAuth(t, func(c *Config) { c.Mode = ModeNone })
	id, err := a.Identify(httptest.NewRequest(http.MethodGet, "/", nil))
	if err != nil || !id.Admin || id.User != "local" {
		t.Fatalf("got %+v, %v", id, err)
	}
}

func TestConfigErrors(t *testing.T) {
	reg := secrets.NewRegistry()
	t.Setenv("SHORT_KEY", "short")
	for name, cfg := range map[string]Config{
		"unknown mode":   {Mode: "ldap"},
		"short key":      {Mode: ModeAnonymous, SessionKey: "env:SHORT_KEY"},
		"no password":    {Mode: ModePassword},
		"oidc no issuer": {Mode: ModeOIDC},
	} {
		if _, err := New(context.Background(), cfg, reg, "https://x"); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestSafeRedirect(t *testing.T) {
	for in, want := range map[string]string{
		"/session/fake/1": "/session/fake/1",
		"":                "/",
		"//evil.com":      "/",
		"https://evil":    "/",
		"/\\evil.com":     "/",
	} {
		if got := SafeRedirect(in); got != want {
			t.Errorf("SafeRedirect(%q) = %q, want %q", in, got, want)
		}
	}
}
