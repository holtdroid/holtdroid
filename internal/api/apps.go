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
	"strconv"
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
	Pinned      bool      `json:"pinned" doc:"shown before other apps, for everyone"`
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

type pinAppInput struct {
	Package string `path:"package" maxLength:"255"`
	Body    struct {
		Pinned bool `json:"pinned"`
	}
}

func (s *Server) listApps(ctx context.Context) ([]AppInfo, error) {
	objs, err := s.apps.List(ctx, appsPrefix)
	if err != nil {
		return nil, err
	}
	items := []AppInfo{}
	for _, o := range objs {
		pkg, ok := strings.CutSuffix(strings.TrimPrefix(o.Key, appsPrefix), ".json")
		if !ok || !appDataPackage.MatchString(pkg) {
			continue
		}
		r, _, err := s.apps.Get(ctx, o.Key)
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

func appKey(pkg string) string { return appsPrefix + pkg + ".json" }

func (s *Server) readApp(ctx context.Context, pkg string) (AppInfo, error) {
	info := AppInfo{Package: pkg}
	r, _, err := s.apps.Get(ctx, appKey(pkg))
	if errors.Is(err, storage.ErrNotExist) {
		return info, nil
	}
	if err != nil {
		return info, err
	}
	defer r.Close()
	err = json.NewDecoder(io.LimitReader(r, 1<<16)).Decode(&info)
	info.Package = pkg
	return info, err
}

// changeApp applies edit to the stored app; one with nothing left is removed.
func (s *Server) changeApp(ctx context.Context, pkg string, edit func(*AppInfo)) (AppInfo, error) {
	info, err := s.readApp(ctx, pkg)
	if err != nil {
		return info, err
	}
	edit(&info)
	info.UpdatedAt = s.now().UTC()
	if who, ok := auth.FromContext(ctx); ok {
		info.UpdatedBy = cmp.Or(who.Name, who.Email, who.User)
	}
	key := appKey(pkg)
	if info.Description == "" && !info.Pinned {
		if err := s.apps.Delete(ctx, key); err != nil && !errors.Is(err, storage.ErrNotExist) {
			return info, err
		}
		return info, nil
	}
	data, err := json.Marshal(info)
	if err != nil {
		return info, err
	}
	return info, s.apps.Put(ctx, key, bytes.NewReader(data), int64(len(data)))
}

func (s *Server) registerApps(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "listApps", Method: http.MethodGet, Path: "/api/v1/apps", Tags: tags,
		Description: "Descriptions and pins of apps by package name. Apps with neither are not listed.",
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
			info, err = s.changeApp(ctx, in.Package, func(a *AppInfo) { a.Description = strings.TrimSpace(in.Body.Description) })
		}
		s.emitResult(ctx, ev, err)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[AppInfo]{info}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "pinApp", Method: http.MethodPut, Path: "/api/v1/apps/{package}/pin", Tags: tags,
		Description: "Pins an app before the others, for everyone. Anyone signed in may change it.",
	}, func(ctx context.Context, in *pinAppInput) (*out[AppInfo], error) {
		ev := audit.Event{Action: audit.AppUpdate, Details: map[string]string{"package": in.Package, "pinned": strconv.FormatBool(in.Body.Pinned)}}
		var info AppInfo
		err := contract.ErrInvalid
		if appDataPackage.MatchString(in.Package) {
			info, err = s.changeApp(ctx, in.Package, func(a *AppInfo) { a.Pinned = in.Body.Pinned })
		}
		s.emitResult(ctx, ev, err)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[AppInfo]{info}, nil
	})
}
