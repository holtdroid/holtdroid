package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/descope/virtualwebauthn"

	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/users"
)

const usersOrigin = "https://holtdroid.test"

type browser struct {
	h       *harness
	cookies map[string]*http.Cookie
	auth    virtualwebauthn.Authenticator
	creds   []virtualwebauthn.Credential
}

func (h *harness) browser() *browser {
	return &browser{h: h, cookies: map[string]*http.Cookie{}, auth: virtualwebauthn.NewAuthenticator()}
}

func (b *browser) do(method, path string, body any) *httptest.ResponseRecorder {
	b.h.t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	r := httptest.NewRequest(method, path, bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	for _, c := range b.cookies {
		r.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	b.h.handler.ServeHTTP(rec, r)
	for _, c := range rec.Result().Cookies() {
		if c.MaxAge < 0 {
			delete(b.cookies, c.Name)
		} else {
			b.cookies[c.Name] = c
		}
	}
	return rec
}

func (b *browser) expect(rec *httptest.ResponseRecorder, code int) {
	b.h.t.Helper()
	if rec.Code != code {
		b.h.t.Fatalf("got %d, want %d: %s", rec.Code, code, rec.Body.String())
	}
}

var rp = virtualwebauthn.RelyingParty{ID: "holtdroid.test", Name: "Holtdroid", Origin: usersOrigin}

func (b *browser) register(begin, finish string, body any) *httptest.ResponseRecorder {
	b.h.t.Helper()
	rec := b.do(http.MethodPost, begin, body)
	if rec.Code != http.StatusOK {
		return rec
	}
	opts, err := virtualwebauthn.ParseAttestationOptions(string(decode[struct{ Options json.RawMessage }](b.h.t, rec).Options))
	if err != nil {
		b.h.t.Fatal(err)
	}
	cred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	b.auth.Options.UserHandle = []byte(opts.UserID)
	b.auth.AddCredential(cred)
	b.creds = append(b.creds, cred)
	resp := virtualwebauthn.CreateAttestationResponse(rp, b.auth, cred, *opts)
	return b.do(http.MethodPost, finish, map[string]any{"credential": json.RawMessage(resp), "name": "Test key"})
}

func (b *browser) signIn() *httptest.ResponseRecorder {
	b.h.t.Helper()
	rec := b.do(http.MethodPost, "/api/v1/auth/passkey/begin", nil)
	b.expect(rec, http.StatusOK)
	opts, err := virtualwebauthn.ParseAssertionOptions(string(decode[struct{ Options json.RawMessage }](b.h.t, rec).Options))
	if err != nil {
		b.h.t.Fatal(err)
	}
	resp := virtualwebauthn.CreateAssertionResponse(rp, b.auth, b.creds[0], *opts)
	return b.do(http.MethodPost, "/api/v1/auth/passkey/finish", map[string]any{"credential": json.RawMessage(resp)})
}

func token(link string) string { return link[strings.LastIndex(link, "/")+1:] }

func newUsersHarness(t *testing.T) *harness {
	return newHarnessWith(t, 4, func(c *Config) {
		c.PublicURL = usersOrigin
		c.Auth.Mode = auth.ModeUsers
		c.Auth.Users.AllowedDomains = []string{"example.com", "example.org"}
	})
}

func TestUsersMode(t *testing.T) {
	h := newUsersHarness(t)
	link, first, err := h.srv.users.Bootstrap(context.Background())
	if err != nil || !first {
		t.Fatalf("bootstrap: %v %v", first, err)
	}

	admin := h.browser()
	admin.expect(admin.do(http.MethodGet, "/api/v1/sessions", nil), http.StatusUnauthorized)
	info := decode[users.InviteInfo](t, admin.do(http.MethodGet, "/api/v1/auth/invites/"+token(link), nil))
	if info.Kind != users.KindBootstrap || info.Role != users.RoleAdmin {
		t.Fatalf("bootstrap invite = %+v", info)
	}
	rec := admin.register("/api/v1/auth/invites/"+token(link)+"/begin", "/api/v1/auth/invites/"+token(link)+"/finish",
		map[string]string{"name": "Ada", "email": "ada@example.com"})
	admin.expect(rec, http.StatusOK)
	if st := decode[AuthStatus](t, rec); st.Identity == nil || !st.Identity.Admin {
		t.Fatalf("after bootstrap: %+v", st)
	}
	if _, again, _ := h.srv.users.Bootstrap(context.Background()); again {
		t.Fatal("bootstrap after an admin exists")
	}
	admin.expect(admin.do(http.MethodGet, "/api/v1/auth/invites/"+token(link), nil), http.StatusGone)

	admin.cookies = map[string]*http.Cookie{}
	admin.expect(admin.signIn(), http.StatusOK)
	admin.expect(admin.do(http.MethodGet, "/api/v1/admin/users", nil), http.StatusOK)

	created := decode[InviteCreated](t, admin.do(http.MethodPost, "/api/v1/admin/invites", map[string]any{
		"role": "", "domains": []string{"example.org"}, "singleUse": false, "note": "waiting room",
	}))
	inv := "/api/v1/auth/invites/" + token(created.Link)

	bob := h.browser()
	bob.expect(bob.register(inv+"/begin", inv+"/finish", map[string]string{"name": "Bob", "email": "bob@example.com"}), http.StatusUnprocessableEntity)
	bob.expect(bob.register(inv+"/begin", inv+"/finish", map[string]string{"name": "Bob", "email": "bob@elsewhere.net"}), http.StatusUnprocessableEntity)
	rec = bob.register(inv+"/begin", inv+"/finish", map[string]string{"name": "Bob", "email": "Bob@Example.org"})
	bob.expect(rec, http.StatusOK)
	st := decode[AuthStatus](t, rec)
	if st.Identity == nil || !st.Identity.Pending || st.Identity.Email != "bob@example.org" {
		t.Fatalf("bob after sign-up: %+v", st.Identity)
	}
	bob.expect(bob.do(http.MethodGet, "/api/v1/sessions", nil), http.StatusForbidden)
	if st := decode[AuthStatus](t, bob.do(http.MethodGet, "/api/v1/auth", nil)); st.Identity == nil || !st.Identity.Pending {
		t.Fatalf("pending status: %+v", st)
	}
	carol := h.browser()
	carol.expect(carol.register(inv+"/begin", inv+"/finish", map[string]string{"name": "Carol", "email": "carol@example.org"}), http.StatusOK)

	one := int64(1)
	bobID := st.Identity.User
	admin.expect(admin.do(http.MethodPut, "/api/v1/admin/users/"+bobID, map[string]any{
		"name": "Bob", "email": "bob@example.org", "role": "user", "limits": map[string]any{"maxSessions": one},
	}), http.StatusOK)
	newSession := map[string]string{"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake"}
	bob.expect(bob.do(http.MethodPost, "/api/v1/sessions", newSession), http.StatusCreated)
	bob.expect(bob.do(http.MethodPost, "/api/v1/sessions", newSession), http.StatusTooManyRequests)

	recovery := decode[RecoveryLink](t, admin.do(http.MethodPost, "/api/v1/admin/users/"+bobID+"/recovery", map[string]any{"ttl": 3600}))
	rt := "/api/v1/auth/invites/" + token(recovery.Link)
	if info := decode[users.InviteInfo](t, bob.do(http.MethodGet, rt, nil)); info.Kind != users.KindRecovery || info.Email != "bob@example.org" {
		t.Fatalf("recovery info = %+v", info)
	}
	newBob := h.browser()
	newBob.expect(newBob.register(rt+"/begin", rt+"/finish", map[string]string{}), http.StatusOK)
	newBob.expect(newBob.do(http.MethodGet, rt, nil), http.StatusGone)
	acct := decode[Account](t, newBob.do(http.MethodGet, "/api/v1/account", nil))
	if len(acct.Passkeys) != 2 || acct.User.Effective.MaxSessions != 1 {
		t.Fatalf("account = %+v", acct)
	}
	newBob.expect(newBob.do(http.MethodDelete, "/api/v1/account/passkeys/"+acct.Passkeys[0].ID, nil), http.StatusOK)
	newBob.expect(newBob.do(http.MethodDelete, "/api/v1/account/passkeys/"+acct.Passkeys[1].ID, nil), http.StatusConflict)
	bob.expect(bob.signIn(), http.StatusUnauthorized)

	me := decode[auth.Identity](t, admin.do(http.MethodGet, "/api/v1/me", nil))
	admin.expect(admin.do(http.MethodPut, "/api/v1/admin/users/"+me.User, map[string]any{
		"name": "Ada", "email": "ada@example.com", "role": "user", "limits": map[string]any{},
	}), http.StatusConflict)

	admin.expect(admin.do(http.MethodDelete, "/api/v1/admin/users/"+bobID, nil), http.StatusNoContent)
	newBob.expect(newBob.do(http.MethodGet, "/api/v1/sessions", nil), http.StatusUnauthorized)
	newBob.expect(newBob.do(http.MethodGet, "/api/v1/admin/users", nil), http.StatusUnauthorized)
	carol.expect(carol.do(http.MethodGet, "/api/v1/admin/users", nil), http.StatusForbidden)
}
