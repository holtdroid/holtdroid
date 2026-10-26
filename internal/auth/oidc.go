package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/oauth2"

	"github.com/holtdroid/holtdroid/internal/secrets"
)

const (
	OIDCLoginPath    = "/api/v1/auth/oidc/login"
	OIDCCallbackPath = "/api/v1/auth/oidc/callback"
	oidcStateCookie  = "holtdroid_oidc"
	oidcStateTTL     = 10 * time.Minute
)

type oidcClient struct {
	cfg          OIDCConfig
	clientSecret string
	redirectURL  string

	mu       sync.Mutex
	provider *oidc.Provider
}

func newOIDCClient(ctx context.Context, cfg OIDCConfig, reg *secrets.Registry, publicURL string) (*oidcClient, error) {
	if cfg.Issuer == "" || cfg.ClientID == "" {
		return nil, errors.New("auth.oidc.issuer and auth.oidc.clientID are required for the oidc mode")
	}
	c := &oidcClient{cfg: cfg, redirectURL: cfg.RedirectURL}
	if c.redirectURL == "" {
		if publicURL == "" {
			return nil, errors.New("auth.oidc needs publicURL or auth.oidc.redirectURL")
		}
		c.redirectURL = strings.TrimRight(publicURL, "/") + OIDCCallbackPath
	}
	if !cfg.ClientSecret.IsZero() {
		secret, err := reg.Resolve(ctx, cfg.ClientSecret)
		if err != nil {
			return nil, fmt.Errorf("auth.oidc.clientSecret: %w", err)
		}
		c.clientSecret = secret
	}
	if len(c.cfg.Scopes) == 0 {
		c.cfg.Scopes = []string{oidc.ScopeOpenID, "profile", "email"}
	}
	if c.cfg.UsernameClaim == "" {
		c.cfg.UsernameClaim = "preferred_username"
	}
	if c.cfg.PictureClaim == "" {
		c.cfg.PictureClaim = "picture"
	}
	return c, nil
}

// discover is lazy so the api starts even while the identity provider is down.
func (c *oidcClient) discover(ctx context.Context) (*oidc.Provider, *oauth2.Config, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.provider == nil {
		p, err := oidc.NewProvider(ctx, c.cfg.Issuer)
		if err != nil {
			return nil, nil, fmt.Errorf("oidc discovery: %w", err)
		}
		c.provider = p
	}
	return c.provider, &oauth2.Config{
		ClientID:     c.cfg.ClientID,
		ClientSecret: c.clientSecret,
		Endpoint:     c.provider.Endpoint(),
		RedirectURL:  c.redirectURL,
		Scopes:       c.cfg.Scopes,
	}, nil
}

type oidcState struct {
	jwt.RegisteredClaims
	State    string `json:"state"`
	Nonce    string `json:"nonce"`
	Verifier string `json:"verifier"`
	Redirect string `json:"redirect"`
}

func randomToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// SafeRedirect keeps post-login redirects on this origin.
func SafeRedirect(target string) string {
	if !strings.HasPrefix(target, "/") || strings.HasPrefix(target, "//") || strings.HasPrefix(target, "/\\") {
		return "/"
	}
	return target
}

// OIDCHandler serves the login redirect and the callback.
func (a *Authenticator) OIDCHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+OIDCLoginPath, a.oidcLogin)
	mux.HandleFunc("GET "+OIDCCallbackPath, a.oidcCallback)
	return mux
}

func (a *Authenticator) oidcLogin(w http.ResponseWriter, r *http.Request) {
	if a.oidc == nil {
		http.NotFound(w, r)
		return
	}
	_, oauth, err := a.oidc.discover(r.Context())
	if err != nil {
		a.log.Error("oidc login failed", "err", err)
		http.Error(w, "identity provider unavailable", http.StatusBadGateway)
		return
	}
	st := oidcState{
		Issuer: issuer, ExpiresAt: jwt.NewNumericDate(a.now().Add(oidcStateTTL)),
		State:    randomToken(),
		Nonce:    randomToken(),
		Verifier: oauth2.GenerateVerifier(),
		Redirect: SafeRedirect(r.URL.Query().Get("redirect")),
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, st).SignedString(a.key)
	if err != nil {
		http.Error(w, "could not start sign-in", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, a.cookie(oidcStateCookie, signed, "/api/v1/auth/oidc", oidcStateTTL))
	http.Redirect(w, r, oauth.AuthCodeURL(st.State, oidc.Nonce(st.Nonce), oauth2.S256ChallengeOption(st.Verifier)), http.StatusFound)
}

func (a *Authenticator) oidcCallback(w http.ResponseWriter, r *http.Request) {
	if a.oidc == nil {
		http.NotFound(w, r)
		return
	}
	expired := a.cookie(oidcStateCookie, "", "/api/v1/auth/oidc", 0)
	expired.MaxAge = -1
	http.SetCookie(w, expired)

	if e := r.URL.Query().Get("error"); e != "" {
		http.Error(w, "sign-in failed: "+e+" "+r.URL.Query().Get("error_description"), http.StatusUnauthorized)
		return
	}
	c, err := r.Cookie(oidcStateCookie)
	if err != nil {
		http.Error(w, "sign-in expired, please try again", http.StatusBadRequest)
		return
	}
	var st oidcState
	if _, err := jwt.ParseWithClaims(c.Value, &st, func(*jwt.Token) (any, error) { return a.key, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer(issuer), jwt.WithTimeFunc(a.now),
	); err != nil || st.State == "" || r.URL.Query().Get("state") != st.State {
		http.Error(w, "sign-in state mismatch, please try again", http.StatusBadRequest)
		return
	}

	id, err := a.oidcIdentity(r.Context(), r.URL.Query().Get("code"), st)
	if err == nil && a.cfg.Mode == ModeUsers {
		id, err = a.Directory.SignInOIDC(r.Context(), id, intersects(id.Groups, a.cfg.AdminGroups))
	}
	if a.OnSignIn != nil {
		a.OnSignIn(r.Context(), ModeOIDC, id, err)
	}
	if errors.Is(err, ErrForbidden) {
		http.Error(w, "your account is not allowed to use Holtdroid", http.StatusForbidden)
		return
	}
	if err != nil {
		a.log.Warn("oidc callback failed", "err", err)
		http.Error(w, "sign-in failed", http.StatusUnauthorized)
		return
	}
	session, err := a.SessionCookie(id)
	if err != nil {
		http.Error(w, "could not create session", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, session)
	http.Redirect(w, r, st.Redirect, http.StatusFound)
}

func (a *Authenticator) oidcIdentity(ctx context.Context, code string, st oidcState) (Identity, error) {
	provider, oauth, err := a.oidc.discover(ctx)
	if err != nil {
		return Identity{}, err
	}
	token, err := oauth.Exchange(ctx, code, oauth2.VerifierOption(st.Verifier))
	if err != nil {
		return Identity{}, fmt.Errorf("code exchange: %w", err)
	}
	rawID, ok := token.Extra("id_token").(string)
	if !ok {
		return Identity{}, errors.New("no id_token in token response")
	}
	idToken, err := provider.Verifier(&oidc.Config{ClientID: a.oidc.cfg.ClientID, Now: a.now}).Verify(ctx, rawID)
	if err != nil {
		return Identity{}, fmt.Errorf("verify id_token: %w", err)
	}
	if idToken.Nonce != st.Nonce {
		return Identity{}, errors.New("nonce mismatch")
	}

	claims := map[string]any{}
	if err := idToken.Claims(&claims); err != nil {
		return Identity{}, err
	}
	if info, err := provider.UserInfo(ctx, oauth2.StaticTokenSource(token)); err == nil {
		extra := map[string]any{}
		if info.Claims(&extra) == nil && extra["sub"] == claims["sub"] {
			for k, v := range extra {
				if _, exists := claims[k]; !exists {
					claims[k] = v
				}
			}
		}
	}

	id := Identity{
		User:    firstString(claims, a.oidc.cfg.UsernameClaim, "preferred_username", "email", "sub"),
		Name:    firstString(claims, "name"),
		Email:   firstString(claims, "email"),
		Picture: firstString(claims, a.oidc.cfg.PictureClaim, "picture"),
		Groups:  stringList(claims[a.oidc.cfg.GroupsClaim]),
	}
	if id.User == "" {
		return Identity{}, errors.New("id_token has no usable username claim")
	}
	return a.authorize(id)
}

func firstString(claims map[string]any, keys ...string) string {
	for _, k := range keys {
		if s, ok := claims[k].(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func stringList(v any) []string {
	switch t := v.(type) {
	case []any:
		out := make([]string, 0, len(t))
		for _, item := range t {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	case string:
		return strings.Fields(strings.ReplaceAll(t, ",", " "))
	default:
		return []string{}
	}
}
