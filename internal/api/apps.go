package api

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/storage"
)

const appsPrefix = "apps/"

type AppInfo struct {
	Package     string    `json:"package"`
	Description string    `json:"description" doc:"plain text shown above the app's builds; blank lines separate paragraphs"`
	UpdatedBy   string    `json:"updatedBy,omitempty"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type AppList struct {
	Items []AppInfo `json:"items"`
}

type putAppInput struct {
	Package string `path:"package" maxLength:"255"`
	Body    struct {
		Description string `json:"description" maxLength:"4000" doc:"an empty one removes it"`
	}
}

func (s *Server) listApps(ctx context.Context) ([]AppInfo, error) {
	objs, err := s.store.List(ctx, appsPrefix)
	if err != nil {
		return nil, err
	}
	items := []AppInfo{}
	for _, o := range objs {
		pkg, ok := strings.CutSuffix(strings.TrimPrefix(o.Key, appsPrefix), ".json")
		if !ok || !appDataPackage.MatchString(pkg) {
			continue
		}
		r, _, err := s.store.Get(ctx, o.Key)
		if errors.Is(err, storage.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		var info AppInfo
		err = json.NewDecoder(io.LimitReader(r, 1<<16)).Decode(&info)
		_ = r.Close()
		if err != nil {
			s.log.Warn("app info", "key", o.Key, "err", err)
			continue
		}
		info.Package = pkg
		items = append(items, info)
	}
	slices.SortFunc(items, func(a, b AppInfo) int { return cmp.Compare(a.Package, b.Package) })
	return items, nil
}

func (s *Server) putApp(ctx context.Context, pkg, description string) (AppInfo, error) {
	key := appsPrefix + pkg + ".json"
	info := AppInfo{Package: pkg, Description: strings.TrimSpace(description), UpdatedAt: s.now().UTC()}
	if info.Description == "" {
		if err := s.store.Delete(ctx, key); err != nil && !errors.Is(err, storage.ErrNotExist) {
			return info, err
		}
		return info, nil
	}
	if who, ok := auth.FromContext(ctx); ok {
		info.UpdatedBy = cmp.Or(who.Name, who.Email, who.User)
	}
	data, err := json.Marshal(info)
	if err != nil {
		return info, err
	}
	return info, s.store.Put(ctx, key, bytes.NewReader(data), int64(len(data)))
}

func (s *Server) registerApps(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "listApps", Method: http.MethodGet, Path: "/api/v1/apps", Tags: tags,
		Description: "Descriptions of apps by package name. Apps without one are not listed.",
	}, func(ctx context.Context, _ *struct{}) (*out[AppList], error) {
		items, err := s.listApps(ctx)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[AppList]{AppList{Items: items}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "putApp", Method: http.MethodPut, Path: "/api/v1/apps/{package}", Tags: tags,
		Description: "Sets the description of an app. Anyone signed in may change it.",
	}, func(ctx context.Context, in *putAppInput) (*out[AppInfo], error) {
		ev := audit.Event{Action: audit.AppUpdate, Details: map[string]string{"package": in.Package}}
		var info AppInfo
		err := contract.ErrInvalid
		if appDataPackage.MatchString(in.Package) {
			info, err = s.putApp(ctx, in.Package, in.Body.Description)
		}
		s.emitResult(ctx, ev, err)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[AppInfo]{info}, nil
	})
}
