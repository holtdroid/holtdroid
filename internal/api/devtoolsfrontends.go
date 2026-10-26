package api

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/frontend"
	"github.com/holtdroid/holtdroid/internal/storage"
)

type DevToolsFrontendView struct {
	Rev        string     `json:"rev" doc:"the Chromium commit the frontend was built at"`
	State      string     `json:"state" enum:"warming,ready,incomplete" doc:"warming while being fetched, incomplete when some files failed"`
	Files      int        `json:"files" doc:"files fetched so far, or in the archive"`
	Failed     int        `json:"failed"`
	Archived   bool       `json:"archived" doc:"kept in the store, so it survives a restart"`
	Size       int64      `json:"size,omitempty" doc:"the archive's size"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
}

type DevToolsFrontendList struct {
	Items   []DevToolsFrontendView `json:"items"`
	Storage string                 `json:"storage" doc:"the storage type holding the archives"`
}

type devToolsFrontendPath struct {
	Rev string `path:"rev" pattern:"^[0-9a-f]{7,40}$"`
}

func (s *Server) registerDevToolsFrontends(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "listDevToolsFrontends", Method: http.MethodGet, Path: "/api/v1/admin/devtools-frontends", Tags: tags,
		Description: "The DevTools frontends the portal fetched, one per Chromium revision: how far each fetch is and which are archived. Admins only; 404 when session agents serve the frontend.",
	}, func(ctx context.Context, _ *struct{}) (*out[DevToolsFrontendList], error) {
		if err := s.devToolsAdmin(ctx); err != nil {
			return nil, err
		}
		return &out[DevToolsFrontendList]{s.devToolsFrontends(ctx)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "deleteDevToolsFrontend", Method: http.MethodDelete, Path: "/api/v1/admin/devtools-frontends/{rev}", Tags: tags, DefaultStatus: http.StatusNoContent,
		Description: "Drops a revision's archive and cached files; the next DevTools open fetches it anew. 409 while it is being fetched. Admins only.",
	}, func(ctx context.Context, in *devToolsFrontendPath) (*struct{}, error) {
		if err := s.devToolsAdmin(ctx); err != nil {
			return nil, err
		}
		err := s.frontend.Delete(ctx, in.Rev)
		s.emitResult(ctx, audit.Event{Action: audit.FrontendDelete, Details: map[string]string{"rev": in.Rev}}, err)
		switch {
		case errors.Is(err, frontend.ErrBusy):
			return nil, huma.Error409Conflict(err.Error())
		case errors.Is(err, storage.ErrNotExist):
			return nil, huma.Error404NotFound("no such revision")
		case err != nil:
			return nil, huma.Error500InternalServerError("could not delete the revision", err)
		}
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "fetchDevToolsFrontend", Method: http.MethodPost, Path: "/api/v1/admin/devtools-frontends/{rev}/fetch", Tags: tags, DefaultStatus: http.StatusNoContent,
		Description: "Fetches a revision ahead of the queue, from the archive when there is one. Admins only.",
	}, func(ctx context.Context, in *devToolsFrontendPath) (*struct{}, error) {
		if err := s.devToolsAdmin(ctx); err != nil {
			return nil, err
		}
		s.frontend.Fetch(in.Rev)
		return nil, nil
	})
}

func (s *Server) devToolsAdmin(ctx context.Context) error {
	if who, _ := auth.FromContext(ctx); !who.Admin {
		return huma.Error403Forbidden("only admins can manage DevTools frontends")
	}
	if s.frontend == nil {
		return huma.Error404NotFound("session agents serve the DevTools frontend here")
	}
	return nil
}

func (s *Server) devToolsFrontends(ctx context.Context) DevToolsFrontendList {
	views := map[string]*DevToolsFrontendView{}
	for rev, st := range s.frontend.Statuses() {
		views[rev] = &DevToolsFrontendView{Rev: strings.TrimPrefix(rev, "@"), State: st.State, Files: st.Files, Failed: st.Failed}
	}
	archives, err := s.frontend.Archives(ctx)
	if err != nil {
		s.log.Warn("could not list devtools frontend archives", "err", err)
	}
	for _, a := range archives {
		v, ok := views[a.Rev]
		if !ok {
			v = &DevToolsFrontendView{Rev: strings.TrimPrefix(a.Rev, "@"), State: frontend.StateReady}
			views[a.Rev] = v
		}
		at := a.ArchivedAt
		v.Archived, v.Size, v.ArchivedAt = true, a.Size, &at
	}
	items := make([]DevToolsFrontendView, 0, len(views))
	for _, v := range views {
		items = append(items, *v)
	}
	slices.SortFunc(items, func(a, b DevToolsFrontendView) int { return strings.Compare(a.Rev, b.Rev) })
	storageType := s.cfg.DevTools.Storage.Type
	if storageType == "" {
		storageType = s.cfg.Storage.Type
	}
	return DevToolsFrontendList{Items: items, Storage: storageType}
}
