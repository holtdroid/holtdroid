package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const stateCookie = "holtdroid_ceremony"

type stateClaims struct {
	jwt.RegisteredClaims
	Kind string          `json:"kind"`
	Data json.RawMessage `json:"data"`
}

// StateCookie signs v into a short-lived cookie for a multi-step ceremony
// (passkey sign-in or registration), so any api replica can finish it.
func (a *Authenticator) StateCookie(kind string, v any, ttl time.Duration) (*http.Cookie, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	claims := stateClaims{
		Issuer:    issuer,
		ExpiresAt: jwt.NewNumericDate(a.now().Add(ttl)),
		Kind:      kind,
		Data:      data,
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(a.key)
	if err != nil {
		return nil, err
	}
	return a.cookie(stateCookie, signed, "/api/v1", ttl), nil
}

// StateCookieName is the cookie StateCookie sets, for handlers that read it
// as an input parameter.
const StateCookieName = stateCookie

// ReadState verifies the ceremony cookie's value and decodes it into v.
func (a *Authenticator) ReadState(value, kind string, v any) error {
	var claims stateClaims
	if _, err := jwt.ParseWithClaims(value, &claims, func(*jwt.Token) (any, error) { return a.key, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer(issuer), jwt.WithExpirationRequired(), jwt.WithTimeFunc(a.now),
	); err != nil || claims.Kind != kind {
		return errors.New("the sign-in step expired, please try again")
	}
	return json.Unmarshal(claims.Data, v)
}

// ClearState removes the ceremony cookie.
func (a *Authenticator) ClearState() *http.Cookie {
	c := a.cookie(stateCookie, "", "/api/v1", 0)
	c.MaxAge = -1
	return c
}
