package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/users"
)

const ceremonyTTL = 5 * time.Minute

type ceremonyOut struct {
	SetCookie *http.Cookie `header:"Set-Cookie"`
	Body      struct {
		Options json.RawMessage `json:"options" doc:"PublicKeyCredentialRequestOptions or ...CreationOptions in their JSON form"`
	}
}

type CeremonyIn struct {
	State string `cookie:"holtdroid_ceremony"`
}

type signInOut struct {
	SetCookie []*http.Cookie `header:"Set-Cookie"`
	Body      AuthStatus
}

type credentialBody struct {
	Credential json.RawMessage `json:"credential" doc:"the PublicKeyCredential from the browser, as JSON"`
	Name       string          `json:"name,omitempty" maxLength:"100" doc:"a name for the new passkey"`
}

type TokenPath struct {
	Token string `path:"token" maxLength:"100"`
}

type UserView struct {
	users.User
	Effective EffectiveLimits `json:"effective" doc:"the limits that apply, after role and server defaults"`
}

type EffectiveLimits struct {
	MaxSessions     int   `json:"maxSessions" doc:"0 for no limit"`
	MaxSessionTTL   int64 `json:"maxSessionTTL" doc:"seconds"`
	RecordingsQuota int64 `json:"recordingsQuota" doc:"bytes, 0 for no limit"`
	AppDataMaxSize  int64 `json:"appDataMaxSize" doc:"bytes, 0 for no limit"`
	ReferencesQuota int64 `json:"referencesQuota" doc:"bytes of pixel perfect references, 0 for no limit"`
	MediaQuota      int64 `json:"mediaQuota" doc:"bytes of the media library, 0 for no limit"`
}

func effective(l limits) EffectiveLimits {
	return EffectiveLimits{l.MaxSessions, int64(l.MaxSessionTTL / time.Second), l.RecordingsQuota, l.AppDataMaxSize, l.ReferencesQuota, l.MediaQuota}
}

type Account struct {
	User     UserView        `json:"user"`
	Passkeys []users.Passkey `json:"passkeys"`
}

type UserList struct {
	Items          []UserView                 `json:"items"`
	Defaults       map[string]EffectiveLimits `json:"defaults" doc:"limits per role before a user's own overrides"`
	AllowedDomains []string                   `json:"allowedDomains"`
}

type UserDetail struct {
	UserView
	Passkeys []users.Passkey `json:"passkeys"`
	Sessions int             `json:"sessions" doc:"devices the user runs now"`
}

type UserPath struct {
	ID string `path:"id" maxLength:"64"`
}

type PasskeyPath struct {
	ID string `path:"id" maxLength:"200"`
}

type UserPasskeyPath struct {
	ID      string `path:"id" maxLength:"64"`
	Passkey string `path:"passkey" maxLength:"200"`
}

type InviteCreated struct {
	Invite users.Invite `json:"invite"`
	Link   string       `json:"link"`
}

type UserCreated struct {
	User UserDetail   `json:"user"`
	Link RecoveryLink `json:"link" doc:"a recovery link with which the user registers their first passkey"`
}

type RecoveryLink struct {
	Link      string    `json:"link" doc:"shown only once"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func usersError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, users.ErrNotFound):
		return huma.Error404NotFound(err.Error())
	case errors.Is(err, users.ErrExpired):
		return huma.Error410Gone(err.Error())
	case errors.Is(err, users.ErrEmailTaken), errors.Is(err, users.ErrLastAdmin), errors.Is(err, users.ErrLastPasskey):
		return huma.Error409Conflict(err.Error())
	case errors.Is(err, users.ErrInvalid):
		return huma.Error422UnprocessableEntity(err.Error())
	case errors.Is(err, auth.ErrUnauthenticated):
		return huma.Error401Unauthorized(err.Error())
	}
	return huma.Error500InternalServerError("something went wrong")
}

func (s *Server) usersOn() error {
	if s.users == nil {
		return huma.Error404NotFound("the users auth mode is not enabled")
	}
	return nil
}

func (s *Server) usersAdmin(ctx context.Context) error {
	if err := s.usersOn(); err != nil {
		return err
	}
	if who, _ := auth.FromContext(ctx); !who.Admin {
		return huma.Error403Forbidden("only admins can manage users")
	}
	return nil
}

func (s *Server) userView(ctx context.Context, u users.User) UserView {
	return UserView{User: u, Effective: effective(s.limits(ctx, u.ID))}
}

func (s *Server) signInCookies(ctx context.Context, method string, id auth.Identity) (*signInOut, error) {
	s.signedIn(ctx, method, id, nil)
	c, err := s.auth.SessionCookie(id)
	if err != nil {
		return nil, huma.Error500InternalServerError("could not create session")
	}
	return &signInOut{SetCookie: []*http.Cookie{c, s.auth.ClearState()}, Body: AuthStatus{Mode: s.auth.Mode(), Identity: &id}}, nil
}

func (s *Server) ceremony(kind string, options any, state any) (*ceremonyOut, error) {
	c, err := s.auth.StateCookie(kind, state, ceremonyTTL)
	if err != nil {
		return nil, huma.Error500InternalServerError("could not start")
	}
	out := &ceremonyOut{SetCookie: c}
	if out.Body.Options, err = json.Marshal(options); err != nil {
		return nil, huma.Error500InternalServerError("could not start")
	}
	return out, nil
}

func (s *Server) registerUsers(api huma.API) {
	s.registerPasskeySignIn(api)
	s.registerAccount(api)
	s.registerUserAdmin(api)
}

func (s *Server) registerPasskeySignIn(api huma.API) {
	tags := []string{"auth"}

	huma.Register(api, huma.Operation{
		OperationID: "beginPasskeySignIn", Method: http.MethodPost, Path: "/api/v1/auth/passkey/begin", Tags: tags,
		Description: "Start signing in with a passkey (users mode).",
	}, func(ctx context.Context, _ *struct{}) (*ceremonyOut, error) {
		if err := s.usersOn(); err != nil {
			return nil, err
		}
		assertion, session, err := s.users.BeginLogin()
		if err != nil {
			return nil, usersError(err)
		}
		return s.ceremony("login", assertion.Response, session)
	})

	huma.Register(api, huma.Operation{
		OperationID: "finishPasskeySignIn", Method: http.MethodPost, Path: "/api/v1/auth/passkey/finish", Tags: tags,
	}, func(ctx context.Context, in *struct {
		CeremonyIn
		Body credentialBody
	},
	) (*signInOut, error) {
		if err := s.usersOn(); err != nil {
			return nil, err
		}
		var session webauthn.SessionData
		if err := s.auth.ReadState(in.State, "login", &session); err != nil {
			return nil, huma.Error401Unauthorized(err.Error())
		}
		id, err := s.users.FinishLogin(ctx, session, in.Body.Credential)
		if err != nil {
			s.signedIn(ctx, auth.ModeUsers, id, err)
			return nil, usersError(err)
		}
		return s.signInCookies(ctx, "passkey", id)
	})

	huma.Register(api, huma.Operation{
		OperationID: "getInvite", Method: http.MethodGet, Path: "/api/v1/auth/invites/{token}", Tags: tags,
		Description: "What an invite or recovery link is for, before registering a passkey with it.",
	}, func(ctx context.Context, in *TokenPath) (*out[users.InviteInfo], error) {
		if err := s.usersOn(); err != nil {
			return nil, err
		}
		info, err := s.users.InviteInfo(ctx, in.Token)
		if err != nil {
			return nil, usersError(err)
		}
		return &out[users.InviteInfo]{info}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "beginInviteRegistration", Method: http.MethodPost, Path: "/api/v1/auth/invites/{token}/begin", Tags: tags,
		Description: "Start registering a passkey with an invite (name and email required) or a recovery link.",
	}, func(ctx context.Context, in *struct {
		TokenPath
		Body struct {
			Name  string `json:"name,omitempty" maxLength:"100"`
			Email string `json:"email,omitempty" maxLength:"254"`
		}
	},
	) (*ceremonyOut, error) {
		if err := s.usersOn(); err != nil {
			return nil, err
		}
		creation, reg, err := s.users.BeginRegister(ctx, in.Token, in.Body.Name, in.Body.Email)
		if err != nil {
			return nil, usersError(err)
		}
		return s.ceremony("register", creation.Response, reg)
	})

	huma.Register(api, huma.Operation{
		OperationID: "finishInviteRegistration", Method: http.MethodPost, Path: "/api/v1/auth/invites/{token}/finish", Tags: tags,
	}, func(ctx context.Context, in *struct {
		TokenPath
		CeremonyIn
		Body credentialBody
	},
	) (*signInOut, error) {
		if err := s.usersOn(); err != nil {
			return nil, err
		}
		var reg users.Registration
		if err := s.auth.ReadState(in.State, "register", &reg); err != nil {
			return nil, huma.Error401Unauthorized(err.Error())
		}
		id, err := s.users.FinishRegister(ctx, in.Token, reg, in.Body.Name, in.Body.Credential)
		ev := audit.Event{Action: audit.UserRecovery, Actor: reg.UserID, Details: map[string]string{"user": reg.UserID, "step": "passkey"}}
		if reg.New {
			ev = audit.Event{Action: audit.UserSignUp, Actor: reg.UserID, Details: map[string]string{"email": reg.Email}}
		}
		s.emitResult(ctx, ev, err)
		if err != nil {
			return nil, usersError(err)
		}
		return s.signInCookies(ctx, "passkey", id)
	})
}

func (s *Server) registerAccount(api huma.API) {
	tags := []string{"account"}

	account := func(ctx context.Context) (*out[Account], error) {
		who, _ := auth.FromContext(ctx)
		u, err := s.users.Get(ctx, who.User)
		if err != nil {
			return nil, usersError(err)
		}
		keys, err := s.users.Passkeys(ctx, who.User)
		if err != nil {
			return nil, usersError(err)
		}
		return &out[Account]{Account{User: s.userView(ctx, u), Passkeys: keys}}, nil
	}

	huma.Register(api, huma.Operation{
		OperationID: "getAccount", Method: http.MethodGet, Path: "/api/v1/account", Tags: tags,
		Description: "The caller's own account in the users mode: profile, limits and passkeys.",
	}, func(ctx context.Context, _ *struct{}) (*out[Account], error) {
		if err := s.usersOn(); err != nil {
			return nil, err
		}
		return account(ctx)
	})

	huma.Register(api, huma.Operation{
		OperationID: "updateAccount", Method: http.MethodPatch, Path: "/api/v1/account", Tags: tags,
	}, func(ctx context.Context, in *struct {
		Body struct {
			Name string `json:"name" maxLength:"100"`
		}
	},
	) (*out[Account], error) {
		if err := s.usersOn(); err != nil {
			return nil, err
		}
		who, _ := auth.FromContext(ctx)
		if err := s.users.Rename(ctx, who.User, in.Body.Name); err != nil {
			return nil, usersError(err)
		}
		return account(ctx)
	})

	huma.Register(api, huma.Operation{
		OperationID: "beginAddPasskey", Method: http.MethodPost, Path: "/api/v1/account/passkeys/begin", Tags: tags,
	}, func(ctx context.Context, _ *struct{}) (*ceremonyOut, error) {
		if err := s.usersOn(); err != nil {
			return nil, err
		}
		who, _ := auth.FromContext(ctx)
		creation, reg, err := s.users.BeginAddPasskey(ctx, who.User)
		if err != nil {
			return nil, usersError(err)
		}
		return s.ceremony("add-passkey", creation.Response, reg)
	})

	huma.Register(api, huma.Operation{
		OperationID: "finishAddPasskey", Method: http.MethodPost, Path: "/api/v1/account/passkeys/finish", Tags: tags,
	}, func(ctx context.Context, in *struct {
		CeremonyIn
		Body credentialBody
	},
	) (*accountOut, error) {
		if err := s.usersOn(); err != nil {
			return nil, err
		}
		who, _ := auth.FromContext(ctx)
		var reg users.Registration
		if err := s.auth.ReadState(in.State, "add-passkey", &reg); err != nil {
			return nil, huma.Error401Unauthorized(err.Error())
		}
		err := s.users.FinishAddPasskey(ctx, who.User, reg, in.Body.Name, in.Body.Credential)
		s.emitResult(ctx, audit.Event{Action: audit.PasskeyAdd, Details: map[string]string{"user": who.User}}, err)
		if err != nil {
			return nil, usersError(err)
		}
		a, err := account(ctx)
		if err != nil {
			return nil, err
		}
		return &accountOut{SetCookie: s.auth.ClearState(), Body: a.Body}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "renamePasskey", Method: http.MethodPatch, Path: "/api/v1/account/passkeys/{id}", Tags: tags,
	}, func(ctx context.Context, in *struct {
		PasskeyPath
		Body struct {
			Name string `json:"name" maxLength:"100"`
		}
	},
	) (*out[Account], error) {
		if err := s.usersOn(); err != nil {
			return nil, err
		}
		who, _ := auth.FromContext(ctx)
		if err := s.users.RenamePasskey(ctx, who.User, in.ID, in.Body.Name); err != nil {
			return nil, usersError(err)
		}
		return account(ctx)
	})

	huma.Register(api, huma.Operation{
		OperationID: "deletePasskey", Method: http.MethodDelete, Path: "/api/v1/account/passkeys/{id}", Tags: tags,
		Description: "Remove one of the caller's passkeys; the last one stays.",
	}, func(ctx context.Context, in *PasskeyPath) (*out[Account], error) {
		if err := s.usersOn(); err != nil {
			return nil, err
		}
		who, _ := auth.FromContext(ctx)
		err := s.users.DeletePasskey(ctx, who.User, in.ID, false)
		s.emitResult(ctx, audit.Event{Action: audit.PasskeyDelete, Details: map[string]string{"user": who.User}}, err)
		if err != nil {
			return nil, usersError(err)
		}
		return account(ctx)
	})
}

type accountOut struct {
	SetCookie *http.Cookie `header:"Set-Cookie"`
	Body      Account
}

func (s *Server) roleDefaults() map[string]EffectiveLimits {
	out := map[string]EffectiveLimits{}
	for _, role := range []string{users.RoleAdmin, users.RoleUser} {
		out[role] = effective(s.roleLimits(s.cfg.Auth.Users.Limits[role]))
	}
	return out
}

func (s *Server) registerUserAdmin(api huma.API) {
	tags := []string{"admin"}

	huma.Register(api, huma.Operation{
		OperationID: "listUsers", Method: http.MethodGet, Path: "/api/v1/admin/users", Tags: tags,
		Description: "Everyone in the users mode's directory, people waiting for approval first. Admins only.",
	}, func(ctx context.Context, _ *struct{}) (*out[UserList], error) {
		if err := s.usersAdmin(ctx); err != nil {
			return nil, err
		}
		list, err := s.users.List(ctx)
		if err != nil {
			return nil, usersError(err)
		}
		l := UserList{Items: make([]UserView, 0, len(list)), Defaults: s.roleDefaults(), AllowedDomains: append([]string{}, s.cfg.Auth.Users.AllowedDomains...)}
		for _, u := range list {
			l.Items = append(l.Items, s.userView(ctx, u))
		}
		return &out[UserList]{l}, nil
	})

	detail := func(ctx context.Context, id string) (*out[UserDetail], error) {
		u, err := s.users.Get(ctx, id)
		if err != nil {
			return nil, usersError(err)
		}
		keys, err := s.users.Passkeys(ctx, id)
		if err != nil {
			return nil, usersError(err)
		}
		d := UserDetail{UserView: s.userView(ctx, u), Passkeys: keys}
		items, _ := s.listSessions(ctx)
		for _, v := range items {
			if v.Owner == id {
				d.Sessions++
			}
		}
		return &out[UserDetail]{d}, nil
	}

	huma.Register(api, huma.Operation{
		OperationID: "createUser", Method: http.MethodPost, Path: "/api/v1/admin/users", Tags: tags, DefaultStatus: http.StatusCreated,
		Description: "Add a user without a passkey and return a single-use link with which they register one.",
	}, func(ctx context.Context, in *struct {
		Body struct {
			Name  string `json:"name" maxLength:"100"`
			Email string `json:"email" maxLength:"254"`
			Role  string `json:"role" enum:"admin,user,"`
			TTL   int64  `json:"ttl,omitempty" minimum:"300" maximum:"2592000" default:"604800" doc:"seconds the link lasts"`
		}
	},
	) (*out[UserCreated], error) {
		if err := s.usersAdmin(ctx); err != nil {
			return nil, err
		}
		who, _ := auth.FromContext(ctx)
		u, err := s.users.Create(ctx, in.Body.Name, in.Body.Email, in.Body.Role, users.Overrides{})
		s.emitResult(ctx, audit.Event{Action: audit.UserCreate, Details: map[string]string{"user": u.ID, "email": u.Email, "role": in.Body.Role}}, err)
		if err != nil {
			return nil, usersError(err)
		}
		link, expires, err := s.users.RecoveryLink(ctx, u.ID, time.Duration(in.Body.TTL)*time.Second, who.User)
		if err != nil {
			return nil, usersError(err)
		}
		d, err := detail(ctx, u.ID)
		if err != nil {
			return nil, err
		}
		return &out[UserCreated]{UserCreated{User: d.Body, Link: RecoveryLink{Link: link, ExpiresAt: expires}}}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "getUser", Method: http.MethodGet, Path: "/api/v1/admin/users/{id}", Tags: tags},
		func(ctx context.Context, in *UserPath) (*out[UserDetail], error) {
			if err := s.usersAdmin(ctx); err != nil {
				return nil, err
			}
			return detail(ctx, in.ID)
		})

	huma.Register(api, huma.Operation{
		OperationID: "updateUser", Method: http.MethodPut, Path: "/api/v1/admin/users/{id}", Tags: tags,
		Description: "Replace a user's name, email, role (empty: waiting for approval) and own limits (null: role default).",
	}, func(ctx context.Context, in *struct {
		UserPath
		Body struct {
			Name   string          `json:"name" maxLength:"100"`
			Email  string          `json:"email" maxLength:"254"`
			Role   string          `json:"role" enum:"admin,user,"`
			Limits users.Overrides `json:"limits"`
		}
	},
	) (*out[UserDetail], error) {
		if err := s.usersAdmin(ctx); err != nil {
			return nil, err
		}
		_, err := s.users.Update(ctx, in.ID, users.Update{Name: in.Body.Name, Email: in.Body.Email, Role: in.Body.Role, Limits: in.Body.Limits})
		s.emitResult(ctx, audit.Event{Action: audit.UserUpdate, Details: map[string]string{"user": in.ID, "role": in.Body.Role}}, err)
		if err != nil {
			return nil, usersError(err)
		}
		return detail(ctx, in.ID)
	})

	huma.Register(api, huma.Operation{
		OperationID: "deleteUser", Method: http.MethodDelete, Path: "/api/v1/admin/users/{id}", Tags: tags, DefaultStatus: http.StatusNoContent,
		Description: "Delete a user, their passkeys and their Figma token; they are signed out on their next request. Their devices keep running until reaped.",
	}, func(ctx context.Context, in *UserPath) (*struct{}, error) {
		if err := s.usersAdmin(ctx); err != nil {
			return nil, err
		}
		err := s.users.Delete(ctx, in.ID)
		if err == nil {
			_ = s.db.DeleteFigmaToken(ctx, in.ID)
		}
		s.emitResult(ctx, audit.Event{Action: audit.UserDelete, Details: map[string]string{"user": in.ID}}, err)
		return nil, usersError(err)
	})

	huma.Register(api, huma.Operation{
		OperationID: "deleteUserPasskey", Method: http.MethodDelete, Path: "/api/v1/admin/users/{id}/passkeys/{passkey}", Tags: tags,
		Description: "Remove any passkey of a user, the last one included.",
	}, func(ctx context.Context, in *UserPasskeyPath) (*out[UserDetail], error) {
		if err := s.usersAdmin(ctx); err != nil {
			return nil, err
		}
		err := s.users.DeletePasskey(ctx, in.ID, in.Passkey, true)
		s.emitResult(ctx, audit.Event{Action: audit.PasskeyDelete, Details: map[string]string{"user": in.ID}}, err)
		if err != nil {
			return nil, usersError(err)
		}
		return detail(ctx, in.ID)
	})

	huma.Register(api, huma.Operation{
		OperationID: "createRecoveryLink", Method: http.MethodPost, Path: "/api/v1/admin/users/{id}/recovery", Tags: tags,
		Description: "A single-use link that lets the user register a new passkey. Replaces earlier ones.",
	}, func(ctx context.Context, in *struct {
		UserPath
		Body struct {
			TTL int64 `json:"ttl" minimum:"300" maximum:"2592000" default:"86400" doc:"seconds"`
		}
	},
	) (*out[RecoveryLink], error) {
		if err := s.usersAdmin(ctx); err != nil {
			return nil, err
		}
		who, _ := auth.FromContext(ctx)
		link, expires, err := s.users.RecoveryLink(ctx, in.ID, time.Duration(in.Body.TTL)*time.Second, who.User)
		s.emitResult(ctx, audit.Event{Action: audit.UserRecovery, Details: map[string]string{"user": in.ID, "step": "link"}}, err)
		if err != nil {
			return nil, usersError(err)
		}
		return &out[RecoveryLink]{RecoveryLink{Link: link, ExpiresAt: expires}}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "listInvites", Method: http.MethodGet, Path: "/api/v1/admin/invites", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*out[[]users.Invite], error) {
			if err := s.usersAdmin(ctx); err != nil {
				return nil, err
			}
			list, err := s.users.Invites(ctx)
			if err != nil {
				return nil, usersError(err)
			}
			return &out[[]users.Invite]{list}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "createInvite", Method: http.MethodPost, Path: "/api/v1/admin/invites", Tags: tags, DefaultStatus: http.StatusCreated,
		Description: "An invite link: single-use or reusable, expiring or not, signing people up with a role (empty: waiting for approval).",
	}, func(ctx context.Context, in *struct {
		Body struct {
			Role      string   `json:"role" enum:"admin,user,"`
			Domains   []string `json:"domains,omitempty" maxItems:"20"`
			Note      string   `json:"note,omitempty" maxLength:"200"`
			SingleUse bool     `json:"singleUse"`
			TTL       int64    `json:"ttl,omitempty" minimum:"0" maximum:"31536000" doc:"seconds until it expires, 0 for never"`
		}
	},
	) (*out[InviteCreated], error) {
		if err := s.usersAdmin(ctx); err != nil {
			return nil, err
		}
		who, _ := auth.FromContext(ctx)
		inv, link, err := s.users.CreateInvite(ctx, users.NewInvite{
			Role: in.Body.Role, Domains: in.Body.Domains, Note: in.Body.Note, SingleUse: in.Body.SingleUse,
			TTL: time.Duration(in.Body.TTL) * time.Second, CreatedBy: who.User,
		})
		s.emitResult(ctx, audit.Event{Action: audit.InviteCreate, Details: map[string]string{"invite": inv.ID, "role": in.Body.Role}}, err)
		if err != nil {
			return nil, usersError(err)
		}
		return &out[InviteCreated]{InviteCreated{Invite: inv, Link: link}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "deleteInvite", Method: http.MethodDelete, Path: "/api/v1/admin/invites/{id}", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *UserPath) (*struct{}, error) {
		if err := s.usersAdmin(ctx); err != nil {
			return nil, err
		}
		err := s.users.DeleteInvite(ctx, in.ID)
		s.emitResult(ctx, audit.Event{Action: audit.InviteDelete, Details: map[string]string{"invite": in.ID}}, err)
		return nil, usersError(err)
	})
}
