package api

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/db"
)

const figmaTokenPath = referencesPath + "/figma-token"

type FigmaTokenView struct {
	Storage   string     `json:"storage" enum:"account,browser" doc:"account: the server keeps the caller's token, encrypted; browser: the database is in memory or auth.sessionKey isn't set, so the UI keeps it in the browser"`
	Saved     bool       `json:"saved" doc:"the server keeps a token for the caller"`
	Handle    string     `json:"handle,omitempty" doc:"the Figma account the token belongs to"`
	Hint      string     `json:"hint,omitempty" doc:"the token's last four characters"`
	UpdatedAt *time.Time `json:"updatedAt,omitempty"`
	Server    bool       `json:"server" doc:"the server has a token of its own for everyone (pixelPerfect.figma.token)"`
}

type figmaTokenPut struct {
	Body struct {
		Token string `json:"token" minLength:"8" maxLength:"512"`
	}
}

func (s *Server) figmaBox() (cipher.AEAD, bool) {
	if !s.persistentDB() || s.auth == nil {
		return nil, false
	}
	key, ok := s.auth.DataKey("figma-token")
	if !ok {
		return nil, false
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, false
	}
	aead, err := cipher.NewGCM(block)
	return aead, err == nil
}

func sealToken(box cipher.AEAD, owner, token string) []byte {
	nonce := make([]byte, box.NonceSize())
	_, _ = rand.Read(nonce)
	return box.Seal(nonce, nonce, []byte(token), []byte(owner))
}

func openToken(box cipher.AEAD, owner string, sealed []byte) (string, error) {
	n := box.NonceSize()
	if len(sealed) < n {
		return "", errors.New("sealed token too short")
	}
	plain, err := box.Open(nil, sealed[:n], sealed[n:], []byte(owner))
	return string(plain), err
}

// storedFigmaToken is the caller's own token kept with their account, or "".
func (s *Server) storedFigmaToken(ctx context.Context) string {
	box, ok := s.figmaBox()
	if !ok {
		return ""
	}
	who, _ := auth.FromContext(ctx)
	row, err := s.db.GetFigmaToken(ctx, who.User)
	if err != nil {
		return ""
	}
	token, err := openToken(box, who.User, row.Sealed)
	if err != nil {
		s.log.Warn("pixel perfect: a saved Figma token can't be decrypted; auth.sessionKey changed?", "user", who.User)
		return ""
	}
	return token
}

func (s *Server) figmaTokenView(ctx context.Context) FigmaTokenView {
	v := FigmaTokenView{Storage: "browser", Server: !s.cfg.PixelPerfect.Figma.Token.IsZero()}
	if _, ok := s.figmaBox(); !ok {
		return v
	}
	v.Storage = "account"
	who, _ := auth.FromContext(ctx)
	if row, err := s.db.GetFigmaToken(ctx, who.User); err == nil {
		at := row.UpdatedAt
		v.Saved, v.Handle, v.Hint, v.UpdatedAt = true, row.Handle, row.Hint, &at
	}
	return v
}

func (s *Server) registerFigmaToken(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "getFigmaToken", Method: http.MethodGet, Path: figmaTokenPath, Tags: tags,
		Description: "Whether the caller has a Figma token with their account and where the UI should keep one. Never returns the token.",
	}, func(ctx context.Context, _ *struct{}) (*out[FigmaTokenView], error) {
		if s.references == nil {
			return nil, httpError(errReferencesDisabled)
		}
		return &out[FigmaTokenView]{s.figmaTokenView(ctx)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "putFigmaToken", Method: http.MethodPut, Path: figmaTokenPath, Tags: tags,
		Description: "Checks a Figma personal access token with Figma (GET /v1/me) and, where storage is account, keeps it encrypted with the caller's account. With browser storage it is only checked.",
	}, func(ctx context.Context, in *figmaTokenPut) (*out[FigmaTokenView], error) {
		if s.references == nil {
			return nil, httpError(errReferencesDisabled)
		}
		token := strings.TrimSpace(in.Body.Token)
		var me struct {
			Handle string `json:"handle"`
			Email  string `json:"email"`
		}
		if err := s.figmaGet(ctx, token, "/v1/me", url.Values{}, &me); err != nil {
			return nil, httpError(err)
		}
		handle := me.Handle
		if me.Email != "" {
			handle = fmt.Sprintf("%s (%s)", me.Handle, me.Email)
		}
		v := s.figmaTokenView(ctx)
		hint := token[max(0, len(token)-4):]
		if box, ok := s.figmaBox(); ok {
			who, _ := auth.FromContext(ctx)
			now := s.now().UTC()
			if err := s.db.PutFigmaToken(ctx, db.PutFigmaTokenParams{
				Owner: who.User, Sealed: sealToken(box, who.User, token), Handle: handle, Hint: hint, UpdatedAt: now,
			}); err != nil {
				return nil, httpError(err)
			}
			v.Saved, v.UpdatedAt = true, &now
		}
		v.Handle, v.Hint = handle, hint
		return &out[FigmaTokenView]{v}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "deleteFigmaToken", Method: http.MethodDelete, Path: figmaTokenPath, Tags: tags,
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, _ *struct{}) (*struct{}, error) {
		if _, ok := s.figmaBox(); !ok {
			return nil, nil
		}
		who, _ := auth.FromContext(ctx)
		return nil, httpError(s.db.DeleteFigmaToken(ctx, who.User))
	})
}
