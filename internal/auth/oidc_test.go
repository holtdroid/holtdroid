package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/golang-jwt/jwt/v5"

	"github.com/kriakiku/holtdroid/internal/secrets"
)

type fakeIdP struct {
	*httptest.Server
	key    *rsa.PrivateKey
	nonce  string
	groups []string
}

func newFakeIdP(t *testing.T) *fakeIdP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	idp := &fakeIdP{key: key, groups: []string{"users"}}
	mux := http.NewServeMux()
	idp.Server = httptest.NewServer(mux)

	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                idp.URL,
			"authorization_endpoint":                idp.URL + "/authorize",
			"token_endpoint":                        idp.URL + "/token",
			"userinfo_endpoint":                     idp.URL + "/userinfo",
			"jwks_uri":                              idp.URL + "/jwks",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"}}})
	})
	mux.HandleFunc("/authorize", func(w http.ResponseWriter, r *http.Request) {
		idp.nonce = r.URL.Query().Get("nonce")
		if r.URL.Query().Get("code_challenge_method") != "S256" {
			http.Error(w, "pkce required", http.StatusBadRequest)
			return
		}
		redirect := r.URL.Query().Get("redirect_uri") + "?code=abc&state=" + url.QueryEscape(r.URL.Query().Get("state"))
		http.Redirect(w, r, redirect, http.StatusFound)
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		_ = r.ParseForm()
		if !ok || user != "holtdroid" || pass != "s3cret" || r.Form.Get("code") != "abc" || r.Form.Get("code_verifier") == "" {
			http.Error(w, "bad client", http.StatusUnauthorized)
			return
		}
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss": idp.URL, "aud": "holtdroid", "sub": "u-1", "nonce": idp.nonce,
			"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
			"preferred_username": "otter",
		})
		tok.Header["kid"] = "k1"
		raw, _ := tok.SignedString(key)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "at", "token_type": "Bearer", "id_token": raw, "expires_in": 3600})
	})
	mux.HandleFunc("/userinfo", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"sub": "u-1", "name": "Otter", "email": "otter@example.com", "groups": idp.groups, "picture": "https://cdn.example.com/otter.png"})
	})
	t.Cleanup(idp.Close)
	return idp
}

func oidcAuth(t *testing.T, idp *fakeIdP) (*Authenticator, *httptest.Server) {
	t.Helper()
	t.Setenv("TEST_SESSION_KEY", testKey)
	t.Setenv("TEST_CLIENT_SECRET", "s3cret")
	cfg := DefaultConfig()
	cfg.Mode = ModeOIDC
	cfg.SessionKey = "env:TEST_SESSION_KEY"
	cfg.AllowedGroups = []string{"users"}
	cfg.AdminGroups = []string{"admins"}
	cfg.OIDC.Issuer = idp.URL
	cfg.OIDC.ClientID = "holtdroid"
	cfg.OIDC.ClientSecret = "env:TEST_CLIENT_SECRET"

	app := httptest.NewUnstartedServer(nil)
	app.Start()
	t.Cleanup(app.Close)
	a, err := New(context.Background(), cfg, secrets.NewRegistry(), app.URL)
	if err != nil {
		t.Fatal(err)
	}
	app.Config.Handler = a.OIDCHandler()
	return a, app
}

func signIn(t *testing.T, app *httptest.Server, redirect string) (*http.Response, []*http.Cookie) {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	appHost := mustHost(app.URL)
	client := &http.Client{Jar: jar, CheckRedirect: func(req *http.Request, _ []*http.Request) error {
		if req.URL.Host == appHost && req.URL.Path != OIDCCallbackPath {
			return http.ErrUseLastResponse
		}
		return nil
	}}
	resp, err := client.Get(app.URL + OIDCLoginPath + "?redirect=" + url.QueryEscape(redirect))
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	root, _ := url.Parse(app.URL + "/")
	return resp, jar.Cookies(root)
}

func TestOIDCFlow(t *testing.T) {
	idp := newFakeIdP(t)
	a, app := oidcAuth(t, idp)

	resp, cookies := signIn(t, app, "/session/fake/1")
	if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/session/fake/1" {
		t.Fatalf("callback: %d %q", resp.StatusCode, resp.Header.Get("Location"))
	}
	var session *http.Cookie
	for _, c := range cookies {
		if c.Name == "holtdroid_session" && c.Value != "" {
			session = c
		}
	}
	if session == nil {
		t.Fatal("no session cookie")
	}
	id, err := a.Identify(withCookie(httptest.NewRequest(http.MethodGet, "/", nil), session))
	if err != nil {
		t.Fatal(err)
	}
	want := Identity{User: "otter", Name: "Otter", Email: "otter@example.com", Groups: []string{"users"}}
	if id.User != want.User || id.Name != want.Name || id.Email != want.Email || len(id.Groups) != 1 || id.Admin ||
		id.Picture != "https://cdn.example.com/otter.png" {
		t.Fatalf("identity %+v", id)
	}
}

func TestOIDCRejectsOutsiders(t *testing.T) {
	idp := newFakeIdP(t)
	idp.groups = []string{"guests"}
	_, app := oidcAuth(t, idp)
	resp, _ := signIn(t, app, "/")
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func TestOIDCStateMismatch(t *testing.T) {
	idp := newFakeIdP(t)
	_, app := oidcAuth(t, idp)
	resp, err := http.Get(app.URL + OIDCCallbackPath + "?code=abc&state=forged")
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func mustHost(raw string) string {
	u, _ := url.Parse(raw)
	return u.Host
}
