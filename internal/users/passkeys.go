package users

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/db"
)

type waUser struct {
	user  db.User
	creds []webauthn.Credential
}

func (u *waUser) WebAuthnID() []byte                         { return u.user.Handle }
func (u *waUser) WebAuthnName() string                       { return u.user.Email }
func (u *waUser) WebAuthnDisplayName() string                { return u.user.Name }
func (u *waUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

func (s *Service) waUser(ctx context.Context, q *db.Queries, u db.User) (*waUser, error) {
	rows, err := q.ListPasskeys(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	w := &waUser{user: u}
	for _, r := range rows {
		var c webauthn.Credential
		if err := json.Unmarshal(r.Credential, &c); err != nil {
			return nil, fmt.Errorf("passkey %x: %w", r.ID, err)
		}
		w.creds = append(w.creds, c)
	}
	return w, nil
}

type Passkey struct {
	ID         string     `json:"id" doc:"base64url credential id"`
	Name       string     `json:"name"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	Synced     bool       `json:"synced" doc:"backed up by a password manager or platform account"`
}

func (s *Service) Passkeys(ctx context.Context, user string) ([]Passkey, error) {
	rows, err := s.db.ListPasskeys(ctx, user)
	if err != nil {
		return nil, err
	}
	out := make([]Passkey, 0, len(rows))
	for _, r := range rows {
		var c webauthn.Credential
		_ = json.Unmarshal(r.Credential, &c)
		out = append(out, Passkey{
			ID: base64.RawURLEncoding.EncodeToString(r.ID), Name: r.Name, CreatedAt: r.CreatedAt, LastUsedAt: r.LastUsedAt, Synced: c.Flags.BackupState,
		})
	}
	return out, nil
}

// BeginLogin starts a discoverable (username-less) passkey sign-in.
func (s *Service) BeginLogin() (*protocol.CredentialAssertion, *webauthn.SessionData, error) {
	return s.wa.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationPreferred))
}

func (s *Service) FinishLogin(ctx context.Context, session webauthn.SessionData, response []byte) (auth.Identity, error) {
	parsed, err := protocol.ParseCredentialRequestResponseBytes(response)
	if err != nil {
		return auth.Identity{}, fmt.Errorf("%w: %w", auth.ErrUnauthenticated, err)
	}
	var found *waUser
	cred, err := s.wa.ValidateDiscoverableLogin(func(rawID, handle []byte) (webauthn.User, error) {
		u, err := s.db.GetUserByHandle(ctx, handle)
		if err != nil {
			return nil, errors.New("unknown passkey")
		}
		found, err = s.waUser(ctx, s.db.Queries, u)
		return found, err
	}, session, parsed)
	if err != nil {
		return auth.Identity{}, fmt.Errorf("%w: this passkey is not registered here", auth.ErrUnauthenticated)
	}
	data, _ := json.Marshal(cred)
	now := s.now()
	if err := s.db.UsePasskey(ctx, db.UsePasskeyParams{Credential: data, LastUsedAt: &now, ID: cred.ID}); err != nil {
		return auth.Identity{}, err
	}
	return identity(found.user), nil
}

// Registration is what a passkey registration remembers between its two
// steps, sealed into a signed cookie by the api.
type Registration struct {
	Session webauthn.SessionData `json:"session"`
	TokenID string               `json:"tokenId,omitempty"`
	UserID  string               `json:"userId"`
	Handle  []byte               `json:"handle"`
	Name    string               `json:"name"`
	Email   string               `json:"email"`
	New     bool                 `json:"new"`
}

func registrationOptions(existing []webauthn.Credential) []webauthn.RegistrationOption {
	exclude := make([]protocol.CredentialDescriptor, 0, len(existing))
	for _, c := range existing {
		exclude = append(exclude, c.Descriptor())
	}
	return []webauthn.RegistrationOption{
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
		webauthn.WithExclusions(exclude),
	}
}

// BeginRegister starts registering a passkey through an invite (a new user
// with name and email) or a recovery link (an extra passkey for its user).
func (s *Service) BeginRegister(ctx context.Context, token, name, email string) (*protocol.CredentialCreation, Registration, error) {
	inv, err := s.validInvite(ctx, s.db.Queries, token)
	if err != nil {
		return nil, Registration{}, err
	}
	var u db.User
	reg := Registration{TokenID: inv.ID}
	if inv.Kind == KindRecovery {
		if u, err = s.db.GetUser(ctx, *inv.UserID); err != nil {
			return nil, Registration{}, ErrExpired
		}
	} else {
		if name, err = cleanName(name); err != nil {
			return nil, Registration{}, err
		}
		if email, err = s.checkEmail(email, splitDomains(inv.Domains)); err != nil {
			return nil, Registration{}, err
		}
		if _, err := s.db.GetUserByEmail(ctx, email); err == nil {
			return nil, Registration{}, ErrEmailTaken
		}
		u = db.User{ID: newUserID(), Handle: randomBytes(32), Email: email, Name: name, Role: inv.Role}
		reg.New = true
	}
	w, err := s.waUser(ctx, s.db.Queries, u)
	if err != nil {
		return nil, Registration{}, err
	}
	creation, session, err := s.wa.BeginRegistration(w, registrationOptions(w.creds)...)
	if err != nil {
		return nil, Registration{}, err
	}
	reg.Session, reg.UserID, reg.Handle, reg.Name, reg.Email = *session, u.ID, u.Handle, u.Name, u.Email
	return creation, reg, nil
}

// FinishRegister stores the passkey, creating the user for an invite, and
// uses up the link.
func (s *Service) FinishRegister(ctx context.Context, token string, reg Registration, keyName string, response []byte) (auth.Identity, error) {
	parsed, err := protocol.ParseCredentialCreationResponseBytes(response)
	if err != nil {
		return auth.Identity{}, fmt.Errorf("%w: %w", ErrInvalid, err)
	}
	err = s.db.Tx(ctx, func(q *db.Queries) error {
		inv, err := s.validInvite(ctx, q, token)
		if err != nil {
			return err
		}
		if inv.ID != reg.TokenID {
			return ErrExpired
		}
		u := db.User{ID: reg.UserID, Handle: reg.Handle, Email: reg.Email, Name: reg.Name, Role: inv.Role, CreatedAt: s.now()}
		if reg.New {
			if _, err := q.GetUserByEmail(ctx, u.Email); err == nil {
				return ErrEmailTaken
			}
			if err := q.CreateUser(ctx, db.CreateUserParams{ID: u.ID, Handle: u.Handle, Email: u.Email, Name: u.Name, Role: u.Role, CreatedAt: u.CreatedAt}); err != nil {
				return err
			}
		} else if u, err = q.GetUser(ctx, reg.UserID); err != nil {
			return ErrExpired
		}
		if err := s.addPasskey(ctx, q, u, reg.Session, keyName, parsed); err != nil {
			return err
		}
		switch inv.Kind {
		case KindRecovery:
			return q.DeleteRecoveryLinks(ctx, &u.ID)
		case KindBootstrap:
			return q.DeleteBootstrapInvites(ctx)
		}
		return q.UseInvite(ctx, inv.ID)
	})
	if err != nil {
		return auth.Identity{}, err
	}
	return s.Lookup(ctx, reg.UserID)
}

func (s *Service) addPasskey(ctx context.Context, q *db.Queries, u db.User, session webauthn.SessionData, name string, parsed *protocol.ParsedCredentialCreationData) error {
	w, err := s.waUser(ctx, q, u)
	if err != nil {
		return err
	}
	cred, err := s.wa.CreateCredential(w, session, parsed)
	if err != nil {
		return fmt.Errorf("%w: the passkey could not be verified: %w", ErrInvalid, err)
	}
	data, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 {
		name = "Passkey"
	}
	return q.AddPasskey(ctx, db.AddPasskeyParams{ID: cred.ID, UserID: u.ID, Name: name, Credential: data, CreatedAt: s.now()})
}

// BeginAddPasskey starts registering another passkey for a signed-in user.
func (s *Service) BeginAddPasskey(ctx context.Context, user string) (*protocol.CredentialCreation, Registration, error) {
	u, err := s.db.GetUser(ctx, user)
	if err != nil {
		return nil, Registration{}, ErrNotFound
	}
	w, err := s.waUser(ctx, s.db.Queries, u)
	if err != nil {
		return nil, Registration{}, err
	}
	creation, session, err := s.wa.BeginRegistration(w, registrationOptions(w.creds)...)
	if err != nil {
		return nil, Registration{}, err
	}
	return creation, Registration{Session: *session, UserID: u.ID}, nil
}

func (s *Service) FinishAddPasskey(ctx context.Context, user string, reg Registration, name string, response []byte) error {
	if reg.UserID != user {
		return ErrExpired
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(response)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrInvalid, err)
	}
	u, err := s.db.GetUser(ctx, user)
	if err != nil {
		return ErrNotFound
	}
	return s.addPasskey(ctx, s.db.Queries, u, reg.Session, name, parsed)
}

func (s *Service) RenamePasskey(ctx context.Context, user, id, name string) error {
	raw, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil {
		return ErrNotFound
	}
	if name = strings.TrimSpace(name); name == "" || len(name) > 100 {
		return fmt.Errorf("%w: a name of 1 to 100 characters is required", ErrInvalid)
	}
	n, err := s.db.RenamePasskey(ctx, db.RenamePasskeyParams{Name: name, ID: raw, UserID: user})
	if err == nil && n == 0 {
		err = ErrNotFound
	}
	return err
}

// DeletePasskey removes one of user's passkeys. Users keep at least one;
// admins (force) may remove the last, after which only a recovery link
// gets the user back in.
func (s *Service) DeletePasskey(ctx context.Context, user, id string, force bool) error {
	raw, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil {
		return ErrNotFound
	}
	return s.db.Tx(ctx, func(q *db.Queries) error {
		if !force {
			n, err := q.CountPasskeys(ctx, user)
			if err != nil {
				return err
			}
			if n <= 1 {
				return ErrLastPasskey
			}
		}
		n, err := q.DeletePasskey(ctx, db.DeletePasskeyParams{ID: raw, UserID: user})
		if err == nil && n == 0 {
			err = ErrNotFound
		}
		return err
	})
}

func (s *Service) Rename(ctx context.Context, user, name string) error {
	name, err := cleanName(name)
	if err != nil {
		return err
	}
	return s.db.RenameUser(ctx, db.RenameUserParams{Name: name, ID: user})
}

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
