package api

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
)

type ADBInfo struct {
	Browser   bool `json:"browser" doc:"the portal may open ADB connections to sessions from the browser"`
	OwnerOnly bool `json:"ownerOnly" doc:"only a session's owner and admins may"`
}

func (s *Server) registerADB(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "getADB", Method: http.MethodGet, Path: "/api/v1/adb", Tags: []string{"sessions"}},
		func(context.Context, *struct{}) (*out[ADBInfo], error) {
			return &out[ADBInfo]{ADBInfo{Browser: s.cfg.ADB.Browser, OwnerOnly: s.cfg.ADB.OwnerOnly}}, nil
		})
}

var (
	errBrowserADBOff = huma.Error403Forbidden("ADB in the browser is turned off")
	errNotADBOwner   = huma.Error403Forbidden("only the session's owner or an admin may use its ADB")
)

// allowBrowserADB applies adb.browser and adb.ownerOnly; the connection is a
// root shell on emulators.
func (s *Server) allowBrowserADB(r *http.Request, p contract.Provider, id string, who auth.Identity) error {
	if !s.cfg.ADB.Browser {
		return errBrowserADBOff
	}
	if !s.cfg.ADB.OwnerOnly || who.Admin {
		return nil
	}
	sess, err := p.Get(r.Context(), id)
	if err != nil {
		return err
	}
	if sess.Owner != who.User {
		return errNotADBOwner
	}
	return nil
}
