package api

import (
	"cmp"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kriakiku/holtdroid/internal/apk"
	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/source"
)

const (
	uploadPath          = "/api/v1/uploads"
	defaultPollInterval = 30 * time.Second
)

var errUploadsDisabled = errors.New("uploads are disabled")

type ArtifactView struct {
	Source     string        `json:"source"`
	ID         string        `json:"id" doc:"Opaque, URL-safe"`
	Revision   string        `json:"revision" doc:"Changes whenever the file is replaced"`
	FileName   string        `json:"fileName"`
	Size       int64         `json:"size"`
	UploadedAt time.Time     `json:"uploadedAt"`
	Meta       source.Meta   `json:"meta" doc:"Contents of the optional .meta.json sidecar"`
	App        *apk.Metadata `json:"app,omitempty" doc:"Parsed from the APK once it is cached"`
	IconURL    string        `json:"iconUrl,omitempty"`
	CanManage  bool          `json:"canManage" doc:"The caller may change visibility or delete it"`
}

type ArtifactList struct {
	Items      []ArtifactView `json:"items"`
	NextCursor string         `json:"nextCursor,omitempty"`
	Errors     []SourceError  `json:"errors"`
}

type SourceView struct {
	Name     string `json:"name"`
	ReadOnly bool   `json:"readOnly"`
}

type UploadsInfo struct {
	Enabled bool   `json:"enabled"`
	Source  string `json:"source,omitempty"`
	MaxSize int64  `json:"maxSize"`
}

type ArtifactsEvent struct {
	Revision string `json:"revision" doc:"Changes whenever any source gains, loses or replaces a file"`
}

type listArtifactsInput struct {
	Source string `query:"source" doc:"Only list this source"`
	Cursor string `query:"cursor"`
	Limit  int    `query:"limit" minimum:"1" maximum:"500" default:"100"`
}

type artifactPath struct {
	Source string `path:"source"`
	ID     string `path:"id"`
}

type patchArtifactInput struct {
	Source string `path:"source"`
	ID     string `path:"id"`
	Body   struct {
		Visibility source.Visibility `json:"visibility" enum:"public,private"`
	}
}

type iconInput struct {
	Key string `path:"key"`
}

type uploadInput struct {
	RawBody huma.MultipartFormFiles[struct {
		File       huma.FormFile `form:"file" contentType:"application/octet-stream" required:"true"`
		Visibility string        `form:"visibility" enum:"public,private" default:"public" required:"false"`
		Title      string        `form:"title" maxLength:"200" required:"false"`
		Note       string        `form:"note" maxLength:"4000" required:"false"`
		Changelog  string        `form:"changelog" maxLength:"65536" required:"false"`
	}]
}

func (s *Server) registerArtifacts(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{OperationID: "listSources", Method: http.MethodGet, Path: "/api/v1/sources", Tags: tags},
		func(context.Context, *struct{}) (*out[[]SourceView], error) {
			views := make([]SourceView, 0, len(s.srcOrder))
			for _, name := range s.srcOrder {
				views = append(views, SourceView{Name: name, ReadOnly: s.sources[name].ReadOnly()})
			}
			return &out[[]SourceView]{views}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "listArtifacts", Method: http.MethodGet, Path: "/api/v1/artifacts", Tags: tags},
		func(ctx context.Context, in *listArtifactsInput) (*out[ArtifactList], error) {
			list, err := s.listArtifacts(ctx, in.Source, in.Cursor, in.Limit)
			if err != nil {
				return nil, httpError(err)
			}
			return &out[ArtifactList]{list}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "getArtifact", Method: http.MethodGet, Path: "/api/v1/artifacts/{source}/{id}", Tags: tags},
		func(ctx context.Context, in *artifactPath) (*out[ArtifactView], error) {
			_, a, err := s.visibleArtifact(ctx, in.Source, in.ID)
			if err != nil {
				return nil, httpError(err)
			}
			return &out[ArtifactView]{s.artifactView(ctx, in.Source, a)}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "updateArtifact", Method: http.MethodPatch, Path: "/api/v1/artifacts/{source}/{id}", Tags: tags,
		Description: "Changes the visibility of an artifact. Owner or admin only.",
	}, func(ctx context.Context, in *patchArtifactInput) (*out[ArtifactView], error) {
		src, a, err := s.managedArtifact(ctx, in.Source, in.ID)
		if err != nil {
			return nil, httpError(err)
		}
		meta := a.Meta
		meta.Visibility = in.Body.Visibility
		if a, err = src.SetMeta(ctx, a.ID, meta); err != nil {
			return nil, httpError(err)
		}
		s.refreshSource(ctx, in.Source)
		return &out[ArtifactView]{s.artifactView(ctx, in.Source, a)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "deleteArtifact", Method: http.MethodDelete, Path: "/api/v1/artifacts/{source}/{id}", Tags: tags,
		DefaultStatus: http.StatusNoContent, Description: "Deletes an artifact and its sidecar. Owner or admin only.",
	}, func(ctx context.Context, in *artifactPath) (*struct{}, error) {
		src, a, err := s.managedArtifact(ctx, in.Source, in.ID)
		if err != nil {
			return nil, httpError(err)
		}
		if err := src.Delete(ctx, a.ID); err != nil {
			return nil, httpError(err)
		}
		who, _ := auth.FromContext(ctx)
		s.log.Info("artifact deleted", "source", in.Source, "artifact", a.ID, "by", who.User)
		s.refreshSource(ctx, in.Source)
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "getArtifactIcon", Method: http.MethodGet, Path: "/api/v1/icons/{key}", Tags: tags,
		Responses: map[string]*huma.Response{"200": {Description: "PNG icon", Content: map[string]*huma.MediaType{"image/png": {}}}},
	}, func(ctx context.Context, in *iconInput) (*huma.StreamResponse, error) {
		raw, err := s.cache.Icon(ctx, in.Key)
		if err != nil {
			return nil, huma.Error404NotFound("no icon")
		}
		return &huma.StreamResponse{Body: func(hctx huma.Context) {
			hctx.SetHeader("Content-Type", "image/png")
			hctx.SetHeader("Cache-Control", "private, max-age=31536000, immutable")
			_, _ = hctx.BodyWriter().Write(raw)
		}}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "getUploads", Method: http.MethodGet, Path: uploadPath, Tags: tags},
		func(context.Context, *struct{}) (*out[UploadsInfo], error) {
			info := UploadsInfo{Enabled: s.cfg.Uploads.Enabled, MaxSize: int64(s.cfg.Uploads.MaxSize)}
			if info.Enabled {
				info.Source = s.cfg.UploadSource()
			}
			return &out[UploadsInfo]{info}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "uploadArtifact", Method: http.MethodPost, Path: uploadPath, Tags: tags,
		DefaultStatus: http.StatusCreated, BodyReadTimeout: -1,
		Description: "Uploads an APK into the uploads source. The file must be a valid APK no larger than uploads.maxSize.",
	}, func(ctx context.Context, in *uploadInput) (*out[ArtifactView], error) {
		v, err := s.upload(ctx, in)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[ArtifactView]{v}, nil
	})
}

func (s *Server) visibleArtifact(ctx context.Context, name, id string) (*source.Source, source.Artifact, error) {
	src, err := s.source(name)
	if err != nil {
		return nil, source.Artifact{}, err
	}
	key, err := decodeID(id)
	if err != nil {
		return nil, source.Artifact{}, err
	}
	a, err := src.Get(ctx, key)
	if err != nil {
		return nil, source.Artifact{}, err
	}
	who, _ := auth.FromContext(ctx)
	if !a.VisibleTo(who.User, who.Admin) {
		return nil, source.Artifact{}, fmt.Errorf("%w: %s", contract.ErrNotFound, id)
	}
	return src, a, nil
}

func (s *Server) managedArtifact(ctx context.Context, name, id string) (*source.Source, source.Artifact, error) {
	src, a, err := s.visibleArtifact(ctx, name, id)
	if err != nil {
		return nil, source.Artifact{}, err
	}
	who, _ := auth.FromContext(ctx)
	if !a.ManageableBy(who.User, who.Admin) {
		return nil, source.Artifact{}, errForbidden
	}
	if src.ReadOnly() {
		return nil, source.Artifact{}, source.ErrReadOnly
	}
	return src, a, nil
}

func (s *Server) listArtifacts(ctx context.Context, only, cursor string, limit int) (ArtifactList, error) {
	names := s.srcOrder
	if only != "" {
		if _, err := s.source(only); err != nil {
			return ArtifactList{}, err
		}
		names = []string{only}
	}
	offset := 0
	if cursor != "" {
		var err error
		if offset, err = strconv.Atoi(cursor); err != nil || offset < 0 {
			return ArtifactList{}, fmt.Errorf("%w: bad cursor", contract.ErrInvalid)
		}
	}
	if limit <= 0 {
		limit = 100
	}

	type result struct {
		name  string
		items []source.Artifact
		err   error
	}
	results := make([]result, len(names))
	var wg sync.WaitGroup
	for i, name := range names {
		wg.Go(func() {
			items, err := s.sources[name].List(ctx)
			results[i] = result{name, items, err}
		})
	}
	wg.Wait()

	who, _ := auth.FromContext(ctx)
	type entry struct {
		source string
		a      source.Artifact
	}
	var all []entry
	list := ArtifactList{Items: []ArtifactView{}, Errors: []SourceError{}}
	for _, r := range results {
		if r.err != nil {
			list.Errors = append(list.Errors, SourceError{Source: r.name, Message: r.err.Error()})
			continue
		}
		s.library.set(r.name, fingerprint(r.items))
		for _, a := range r.items {
			if a.VisibleTo(who.User, who.Admin) {
				all = append(all, entry{r.name, a})
			}
		}
	}
	slices.SortStableFunc(all, func(a, b entry) int {
		return cmp.Or(b.a.UploadedAt().Compare(a.a.UploadedAt()), cmp.Compare(a.source, b.source), cmp.Compare(a.a.ID, b.a.ID))
	})
	offset = min(offset, len(all))
	end := min(offset+limit, len(all))
	for _, e := range all[offset:end] {
		list.Items = append(list.Items, s.artifactView(ctx, e.source, e.a))
	}
	if end < len(all) {
		list.NextCursor = strconv.Itoa(end)
	}
	n := 0
	for _, e := range all[offset:end] {
		if n < s.cfg.Cache.Warm && !s.cached(ctx, e.source, e.a) {
			s.enqueueWarm(e.source, e.a)
			n++
		}
	}
	return list, nil
}

func (s *Server) artifactView(ctx context.Context, name string, a source.Artifact) ArtifactView {
	who, _ := auth.FromContext(ctx)
	v := ArtifactView{
		Source:     name,
		ID:         encodeID(a.ID),
		Revision:   a.Revision,
		FileName:   a.FileName,
		Size:       a.Size,
		UploadedAt: a.UploadedAt(),
		Meta:       a.Meta,
		CanManage:  a.ManageableBy(who.User, who.Admin) && !s.sources[name].ReadOnly(),
	}
	if e, ok := s.cache.Lookup(ctx, name, a.ID, a.Revision); ok {
		meta := e.Meta
		v.App = &meta
		v.IconURL = iconURL(e)
	}
	return v
}

func encodeID(key string) string { return base64.RawURLEncoding.EncodeToString([]byte(key)) }

func decodeID(id string) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil || len(raw) == 0 {
		return "", fmt.Errorf("%w: artifact %q", contract.ErrNotFound, id)
	}
	return string(raw), nil
}

func iconURL(e CacheEntry) string {
	if !e.HasIcon {
		return ""
	}
	return "/api/v1/icons/" + e.Key
}

func (s *Server) cached(ctx context.Context, name string, a source.Artifact) bool {
	_, ok := s.cache.Lookup(ctx, name, a.ID, a.Revision)
	return ok
}

type warmItem struct {
	source   string
	artifact source.Artifact
}

func (s *Server) enqueueWarm(name string, a source.Artifact) {
	select {
	case s.warm <- warmItem{name, a}:
	default:
	}
}

func (s *Server) upload(ctx context.Context, in *uploadInput) (ArtifactView, error) {
	name := s.cfg.UploadSource()
	if name == "" {
		return ArtifactView{}, errUploadsDisabled
	}
	src, err := s.source(name)
	if err != nil {
		return ArtifactView{}, err
	}
	form := in.RawBody.Data()
	defer form.File.Close()
	if form.File.Size > int64(s.cfg.Uploads.MaxSize) {
		return ArtifactView{}, huma.Error413RequestEntityTooLarge(fmt.Sprintf("the APK is larger than %d bytes", s.cfg.Uploads.MaxSize))
	}

	tmp, err := os.CreateTemp("", "holtdroid-upload-*.apk")
	if err != nil {
		return ArtifactView{}, err
	}
	defer os.Remove(tmp.Name())
	size, err := io.Copy(tmp, form.File)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return ArtifactView{}, err
	}
	meta, icon, err := apk.Parse(tmp.Name())
	if err != nil {
		return ArtifactView{}, fmt.Errorf("%w: not a valid APK: %w", contract.ErrInvalid, err)
	}

	who, _ := auth.FromContext(ctx)
	sidecar := source.Meta{
		Title:      strings.TrimSpace(form.Title),
		Note:       strings.TrimSpace(form.Note),
		Changelog:  strings.TrimSpace(form.Changelog),
		UploadedBy: cmp.Or(who.Name, who.User),
		UploadedAt: s.now().UTC(),
		Origin:     "upload",
		Owner:      who.User,
		Visibility: source.Visibility(cmp.Or(form.Visibility, string(source.Public))),
	}
	f, err := os.Open(tmp.Name())
	if err != nil {
		return ArtifactView{}, err
	}
	defer f.Close()
	a, err := src.Put(ctx, path.Join(s.cfg.Uploads.Prefix, randomHex(6), uploadName(form.File.Filename)), f, size, sidecar)
	if err != nil {
		return ArtifactView{}, err
	}
	if _, err := s.cache.put(ctx, name, a, tmp.Name(), meta, icon); err != nil {
		s.log.Warn("could not cache uploaded APK", "source", name, "artifact", a.ID, "err", err)
	}
	s.log.Info("artifact uploaded", "source", name, "artifact", a.ID, "by", who.User, "package", meta.Package, "visibility", sidecar.Visibility)
	s.refreshSource(ctx, name)
	return s.artifactView(ctx, name, a), nil
}

func uploadName(name string) string {
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	clean := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
			return r
		}
		return '_'
	}, name)
	clean = strings.TrimLeft(clean, ".")
	if len(clean) > 100 {
		clean = clean[len(clean)-100:]
	}
	if !strings.HasSuffix(strings.ToLower(clean), ".apk") {
		clean += ".apk"
	}
	if clean == ".apk" {
		clean = "app.apk"
	}
	return clean
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func fingerprint(items []source.Artifact) string {
	h := sha256.New()
	for _, a := range items {
		_, _ = fmt.Fprintf(h, "%s\x00%s\x00%s\n", a.ID, a.Revision, a.MetaRevision)
	}
	return hex.EncodeToString(h.Sum(nil)[:8])
}

// library tracks a fingerprint per source so the UI can be told when any
// file is added, removed or replaced.
type library struct {
	mu     sync.Mutex
	prints map[string]string
}

func newLibrary() *library { return &library{prints: map[string]string{}} }

func (l *library) set(name, print string) {
	l.mu.Lock()
	l.prints[name] = print
	l.mu.Unlock()
}

func (l *library) revision(order []string) string {
	l.mu.Lock()
	defer l.mu.Unlock()
	h := sha256.New()
	for _, name := range order {
		_, _ = fmt.Fprintf(h, "%s=%s\n", name, l.prints[name])
	}
	return hex.EncodeToString(h.Sum(nil)[:8])
}

func (s *Server) refreshSource(ctx context.Context, name string) {
	items, err := s.sources[name].List(ctx)
	if err != nil {
		s.log.Debug("source poll failed", "source", name, "err", err)
		return
	}
	s.library.set(name, fingerprint(items))
	n := 0
	for _, a := range items {
		if n >= s.cfg.Cache.Warm {
			break
		}
		if !s.cached(ctx, name, a) {
			s.enqueueWarm(name, a)
			n++
		}
	}
}

func (s *Server) watchSources(ctx context.Context) {
	var wg sync.WaitGroup
	for _, sc := range s.cfg.Sources {
		wg.Go(func() {
			ticker := time.NewTicker(cmp.Or(sc.PollInterval, defaultPollInterval))
			defer ticker.Stop()
			for {
				s.refreshSource(ctx, sc.Name)
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
				}
			}
		})
	}
	wg.Wait()
}
