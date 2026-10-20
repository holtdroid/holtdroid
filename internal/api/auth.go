package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/auth"
)

type AuthStatus struct {
	Mode     string         `json:"mode" enum:"anonymous,password,oidc,header,none"`
	Identity *auth.Identity `json:"identity,omitempty"`
	LoginURL string         `json:"loginUrl,omitempty" doc:"Where to send the browser to sign in (oidc)"`
}

type authOut struct {
	SetCookie *http.Cookie `header:"Set-Cookie"`
	Body      AuthStatus
}

type loginInput struct {
	Body struct {
		Password string `json:"password" minLength:"1" maxLength:"1024"`
	}
}

type logoutOut struct {
	SetCookie *http.Cookie `header:"Set-Cookie"`
}

func (s *Server) registerAuth(api huma.API) {
	tags := []string{"auth"}

	huma.Register(api, huma.Operation{
		OperationID: "getAuth", Method: http.MethodGet, Path: "/api/v1/auth", Tags: tags,
		Description: "Who is signed in and how to sign in. In the anonymous mode this signs newcomers in.",
	}, func(ctx context.Context, _ *struct{}) (*authOut, error) {
		out := &authOut{Body: AuthStatus{Mode: s.auth.Mode()}}
		if s.auth.Mode() == auth.ModeOIDC {
			out.Body.LoginURL = auth.OIDCLoginPath
		}
		if id, ok := auth.FromContext(ctx); ok {
			out.Body.Identity = &id
			return out, nil
		}
		if id, ok := s.auth.Anonymous(); ok {
			c, err := s.auth.SessionCookie(id)
			s.signedIn(ctx, auth.ModeAnonymous, id, err)
			if err != nil {
				return nil, huma.Error500InternalServerError("could not create session")
			}
			out.SetCookie = c
			out.Body.Identity = &id
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "login", Method: http.MethodPost, Path: "/api/v1/auth/login", Tags: tags,
		Description: "Sign in with the shared password (password mode).",
	}, func(ctx context.Context, in *loginInput) (*authOut, error) {
		id, err := s.auth.Login(in.Body.Password)
		s.signedIn(ctx, auth.ModePassword, id, err)
		switch {
		case errors.Is(err, auth.ErrBadPassword):
			return nil, huma.Error401Unauthorized("wrong password")
		case err != nil:
			return nil, huma.Error403Forbidden(err.Error())
		}
		c, err := s.auth.SessionCookie(id)
		if err != nil {
			return nil, huma.Error500InternalServerError("could not create session")
		}
		return &authOut{SetCookie: c, Body: AuthStatus{Mode: s.auth.Mode(), Identity: &id}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "logout", Method: http.MethodPost, Path: "/api/v1/auth/logout", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, _ *struct{}) (*logoutOut, error) {
		s.emit(ctx, audit.Event{Action: audit.SignOut})
		return &logoutOut{SetCookie: s.auth.ClearCookie()}, nil
	})
}
