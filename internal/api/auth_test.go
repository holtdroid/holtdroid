package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/auth"
)

func cookieServer(t *testing.T, mode string) http.Handler {
	t.Helper()
	h, _ := cookieServerAudited(t, mode)
	return h
}

func cookieServerAudited(t *testing.T, mode string) (http.Handler, *bytes.Buffer) {
	t.Helper()
	t.Setenv("TEST_KEY", "0123456789abcdef0123456789abcdef")
	t.Setenv("TEST_PASSWORD", "hunter2")
	cfg := DefaultConfig()
	cfg.Storage.Filesystem.Dir = t.TempDir()
	cfg.Auth.Mode = mode
	cfg.Auth.SessionKey = "env:TEST_KEY"
	cfg.Auth.Password = "env:TEST_PASSWORD"
	cfg.Sources[0].Filesystem.Dir = t.TempDir()
	aud, buf := testAudit(t, time.Now)
	srv, err := New(context.Background(), cfg, WithAudit(aud))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	return srv.Handler(), buf
}

func call(h http.Handler, method, path, body string, cookies []*http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	for _, c := range cookies {
		r.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func TestAnonymousSignIn(t *testing.T) {
	h := cookieServer(t, auth.ModeAnonymous)

	rec := call(h, http.MethodGet, "/api/v1/auth", "", nil)
	var status AuthStatus
	_ = json.Unmarshal(rec.Body.Bytes(), &status)
	if rec.Code != http.StatusOK || status.Mode != "anonymous" || status.Identity == nil {
		t.Fatalf("status: %d %s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies %v", cookies)
	}

	rec = call(h, http.MethodGet, "/api/v1/me", "", cookies)
	var me auth.Identity
	_ = json.Unmarshal(rec.Body.Bytes(), &me)
	if me.User != status.Identity.User {
		t.Fatalf("me = %q, want %q", me.User, status.Identity.User)
	}

	if rec := call(h, http.MethodGet, "/", "", nil); rec.Code == http.StatusUnauthorized {
		t.Fatal("UI must be public")
	}
}

func TestPasswordSignIn(t *testing.T) {
	h := cookieServer(t, auth.ModePassword)

	if rec := call(h, http.MethodGet, "/api/v1/sessions", "", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("protected without cookie: %d", rec.Code)
	}
	rec := call(h, http.MethodGet, "/api/v1/auth", "", nil)
	if strings.Contains(rec.Body.String(), "identity") || len(rec.Result().Cookies()) != 0 {
		t.Fatalf("password mode must not sign in on status: %s", rec.Body.String())
	}
	if rec := call(h, http.MethodPost, "/api/v1/auth/login", `{"password":"nope"}`, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password: %d", rec.Code)
	}
	rec = call(h, http.MethodPost, "/api/v1/auth/login", `{"password":"hunter2"}`, nil)
	if rec.Code != http.StatusOK || len(rec.Result().Cookies()) != 1 {
		t.Fatalf("login: %d %v", rec.Code, rec.Result().Cookies())
	}
	cookies := rec.Result().Cookies()
	if rec := call(h, http.MethodGet, "/api/v1/sessions", "", cookies); rec.Code != http.StatusOK {
		t.Fatalf("with cookie: %d", rec.Code)
	}

	rec = call(h, http.MethodPost, "/api/v1/auth/logout", "", cookies)
	if rec.Code != http.StatusNoContent || rec.Result().Cookies()[0].MaxAge >= 0 {
		t.Fatalf("logout: %d %v", rec.Code, rec.Result().Cookies())
	}
}
