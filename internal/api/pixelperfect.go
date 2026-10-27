package api

import (
	"bytes"
	"cmp"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	_ "golang.org/x/image/webp"

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/storage"
)

const (
	referencesPrefix = "pixel-perfect/"
	referencesPath   = "/api/v1/pixel-perfect"
	referenceTouch   = time.Hour
)

var (
	errReferencesDisabled = errors.New("pixel perfect references are turned off on this server")
	errReferenceQuota     = errors.New("the storage for reference images is full; delete some first")
)

var referenceTypes = map[string]string{"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp"}

type Rect struct {
	X float64 `json:"x" minimum:"0" maximum:"1" doc:"left edge as a fraction of the image width"`
	Y float64 `json:"y" minimum:"0" maximum:"1" doc:"top edge as a fraction of the image height"`
	W float64 `json:"w" minimum:"0" maximum:"1"`
	H float64 `json:"h" minimum:"0" maximum:"1"`
}

type Placement struct {
	X     float64 `json:"x" doc:"shift right in the image's own pixels"`
	Y     float64 `json:"y" doc:"shift down in the image's own pixels"`
	Scale float64 `json:"scale" minimum:"0.05" maximum:"20" doc:"1 fits the image to the screen's width without overflowing its height"`
}

// referenceMeta is written only by the api: on upload and on every update.
type referenceMeta struct {
	ID          string       `json:"id"`
	Owner       string       `json:"owner"`
	Name        string       `json:"name"`
	Package     string       `json:"package,omitempty"`
	ContentType string       `json:"contentType"`
	Width       int          `json:"width"`
	Height      int          `json:"height"`
	Placement   Placement    `json:"placement"`
	Ignore      []Rect       `json:"ignore,omitempty"`
	CreatedAt   time.Time    `json:"createdAt"`
	Revision    int          `json:"revision,omitempty"`
	Figma       *FigmaSource `json:"figma,omitempty"`
	Layers      int          `json:"layers,omitempty"`
	Components  int          `json:"components,omitempty"`
	Hidden      []string     `json:"hidden,omitempty"`
}

// referenceStore lays a user's reference images out as
//
//	<user>/<id>.json  referenceMeta
//	<user>/<id>.img   the image
//	<user>/<id>.thumb a small JPEG (or the browser's picture of an SVG) for lists
//	<user>/<id>.used  rewritten when the image is opened; its time is the last use
//	<user>/<id>.layers FigmaLayers of a frame imported from Figma
//	<user>/<id>.part-<n> the picture of its component n
//
// so one listing gives sizes and last uses without reading anything.
type referenceStore struct {
	store  storage.Store
	prefix string
}

type referenceEntry struct {
	user     string
	id       string
	size     int64
	lastUsed time.Time
	meta     bool
	thumb    bool
}

func (r *referenceStore) key(user, id, ext string) string { return r.prefix + user + "/" + id + ext }

func (r *referenceStore) list(ctx context.Context, user string) ([]*referenceEntry, error) {
	prefix := r.prefix
	if user != "" {
		prefix += user + "/"
	}
	objs, err := r.store.List(ctx, prefix)
	if err != nil {
		return nil, err
	}
	byID := map[string]*referenceEntry{}
	var order []*referenceEntry
	for _, o := range objs {
		u, name, ok := strings.Cut(strings.TrimPrefix(o.Key, r.prefix), "/")
		if !ok || !userHash.MatchString(u) {
			continue
		}
		id, ext, _ := strings.Cut(name, ".")
		if !recordingID.MatchString(id) {
			continue
		}
		e := byID[u+"/"+id]
		if e == nil {
			e = &referenceEntry{user: u, id: id}
			byID[u+"/"+id] = e
			order = append(order, e)
		}
		switch {
		case ext == "img", strings.HasPrefix(ext, "part-"):
			e.size += o.Size
		case ext == "json":
			e.meta = true
		case ext == "thumb":
			e.thumb = true
		}
		if (ext == "used" || ext == "json") && o.Modified.After(e.lastUsed) {
			e.lastUsed = o.Modified
		}
	}
	return order, nil
}

func (r *referenceStore) remove(ctx context.Context, user, id string) error {
	return r.removeMatching(ctx, user, id, func(string) bool { return true })
}

// removeMatching deletes a reference's objects whose extension matches.
func (r *referenceStore) removeMatching(ctx context.Context, user, id string, match func(ext string) bool) error {
	objs, err := r.store.List(ctx, r.key(user, id, "."))
	if err != nil {
		return err
	}
	for _, o := range objs {
		ext := strings.TrimPrefix(o.Key, r.key(user, id, "."))
		if strings.Contains(ext, "/") || !match(ext) {
			continue
		}
		if err := r.store.Delete(ctx, o.Key); err != nil && !errors.Is(err, storage.ErrNotExist) {
			return err
		}
	}
	return nil
}

func (r *referenceStore) touch(ctx context.Context, user, id string) error {
	return r.store.Put(ctx, r.key(user, id, ".used"), strings.NewReader("1"), 1)
}

type ReferenceView struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Package     string       `json:"package,omitempty" doc:"the app it was added for"`
	ContentType string       `json:"contentType"`
	Width       int          `json:"width"`
	Height      int          `json:"height"`
	Size        int64        `json:"size" doc:"bytes"`
	Placement   Placement    `json:"placement"`
	Ignore      []Rect       `json:"ignore" doc:"areas the comparison skips, such as a video under the interface"`
	CreatedAt   time.Time    `json:"createdAt"`
	LastUsedAt  time.Time    `json:"lastUsedAt"`
	ExpiresAt   *time.Time   `json:"expiresAt,omitempty" doc:"deleted then unless it is opened again"`
	ImageURL    string       `json:"imageUrl" doc:"opening it counts as a use"`
	ThumbURL    string       `json:"thumbnailUrl,omitempty" doc:"a small picture for lists, at most 160 px wide; opening it is not a use"`
	Figma       *FigmaSource `json:"figma,omitempty" doc:"the Figma frame it was imported from"`
	Layers      int          `json:"layers" doc:"design layers stored with it (GET …/layers); 0 for an image added by hand"`
	Components  int          `json:"components" doc:"parts of a Figma frame that can be hidden (listed with the layers)"`
	Hidden      []string     `json:"hidden" doc:"ids of the components left out of the reference"`
}

type ReferenceList struct {
	Enabled     bool            `json:"enabled"`
	Quota       int64           `json:"quota" doc:"bytes a user's references may take, 0 for no limit"`
	Used        int64           `json:"used" doc:"bytes the caller's references take"`
	MaxAge      int64           `json:"maxAge" doc:"seconds a reference is kept after it was last opened, 0 for no limit"`
	MaxFileSize int64           `json:"maxFileSize" doc:"bytes"`
	FigmaToken  bool            `json:"figmaToken" doc:"the server has a Figma token of its own; without one, importing from Figma needs the user's"`
	FigmaSaved  bool            `json:"figmaSaved" doc:"the caller has a Figma token saved with their account"`
	Items       []ReferenceView `json:"items"`
}

func (s *Server) referenceView(m referenceMeta, e *referenceEntry) ReferenceView {
	v := ReferenceView{
		ID: m.ID, Name: m.Name, Package: m.Package, ContentType: m.ContentType, Width: m.Width, Height: m.Height,
		Placement: m.Placement, Ignore: m.Ignore, CreatedAt: m.CreatedAt, LastUsedAt: m.CreatedAt,
		ImageURL: referencesPath + "/" + m.ID + "/image" + revisionQuery(m.Revision), Figma: m.Figma, Layers: m.Layers,
		Components: m.Components, Hidden: m.Hidden,
	}
	if v.Hidden == nil {
		v.Hidden = []string{}
	}
	if v.Ignore == nil {
		v.Ignore = []Rect{}
	}
	if m.ContentType != svgType || e != nil && e.thumb {
		v.ThumbURL = referencesPath + "/" + m.ID + "/thumbnail" + revisionQuery(m.Revision)
	}
	if e != nil {
		v.Size = e.size
		if e.lastUsed.After(v.LastUsedAt) {
			v.LastUsedAt = e.lastUsed
		}
	}
	if age := s.cfg.PixelPerfect.MaxAge; age > 0 {
		at := v.LastUsedAt.Add(age)
		v.ExpiresAt = &at
	}
	return v
}

func revisionQuery(rev int) string {
	if rev == 0 {
		return ""
	}
	return "?v=" + strconv.Itoa(rev)
}

func (s *Server) referenceUsage(entries []*referenceEntry) int64 {
	var used int64
	for _, e := range entries {
		used += e.size
	}
	return used
}

func (s *Server) ownReference(ctx context.Context, id string) (referenceMeta, string, error) {
	if s.references == nil {
		return referenceMeta{}, "", errReferencesDisabled
	}
	if !recordingID.MatchString(id) {
		return referenceMeta{}, "", fmt.Errorf("%w: reference %s", contract.ErrNotFound, id)
	}
	who, _ := auth.FromContext(ctx)
	user := userDir(who.User)
	m, err := readJSON[referenceMeta](ctx, s.references.store, s.references.key(user, id, ".json"))
	if err == nil && m.Owner != who.User {
		err = fmt.Errorf("%w: reference %s", contract.ErrNotFound, id)
	}
	return m, user, err
}

func cleanReferenceName(name string) string {
	name = strings.Join(strings.Fields(name), " ")
	if r := []rune(name); len(r) > 120 {
		name = string(r[:120])
	}
	return name
}

func validRects(rects []Rect) error {
	if len(rects) > 64 {
		return fmt.Errorf("%w: at most 64 ignored areas", contract.ErrInvalid)
	}
	for _, r := range rects {
		if r.W <= 0 || r.H <= 0 || r.X+r.W > 1.0001 || r.Y+r.H > 1.0001 {
			return fmt.Errorf("%w: an ignored area lies outside the image", contract.ErrInvalid)
		}
	}
	return nil
}

type referenceUploadInput struct {
	RawBody huma.MultipartFormFiles[struct {
		File      huma.FormFile `form:"file" contentType:"image/png,image/jpeg,image/webp,image/svg+xml,application/octet-stream" required:"true"`
		Thumbnail huma.FormFile `form:"thumbnail" contentType:"image/jpeg,image/png,image/webp,application/octet-stream" required:"false" doc:"a picture for lists at most 320×640, which SVGs need since the server doesn't render them"`
		Name      string        `form:"name" maxLength:"120" required:"false"`
		Package   string        `form:"package" maxLength:"255" required:"false"`
	}]
}

type referencePath struct {
	ID string `path:"id"`
}

type referenceUpdateInput struct {
	ID   string `path:"id"`
	Body struct {
		Name      string    `json:"name" maxLength:"120"`
		Placement Placement `json:"placement"`
		Ignore    []Rect    `json:"ignore" maxItems:"64"`
		Hidden    *[]string `json:"hidden,omitempty" maxItems:"64" doc:"ids of the components to leave out; unchanged when missing"`
	}
}

func (s *Server) uploadReference(ctx context.Context, in *referenceUploadInput) (ReferenceView, error) {
	if s.references == nil {
		return ReferenceView{}, errReferencesDisabled
	}
	form := in.RawBody.Data()
	defer form.File.Close()
	max := int64(s.cfg.PixelPerfect.MaxFileSize)
	if form.File.Size > max {
		return ReferenceView{}, fmt.Errorf("%w: the image is larger than %d bytes", contract.ErrTooLarge, max)
	}
	raw, err := io.ReadAll(io.LimitReader(form.File, max+1))
	if err != nil {
		return ReferenceView{}, err
	}
	if int64(len(raw)) > max {
		return ReferenceView{}, fmt.Errorf("%w: the image is larger than %d bytes", contract.ErrTooLarge, max)
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	contentType := referenceTypes[format]
	if err != nil {
		if w, h, ok := svgSize(raw); ok {
			cfg, format, contentType = image.Config{Width: w, Height: h}, "svg", svgType
		}
	}
	if contentType == "" {
		return ReferenceView{}, fmt.Errorf("%w: not a PNG, JPEG, WebP or SVG image with a size", contract.ErrInvalid)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > 64<<20 {
		return ReferenceView{}, fmt.Errorf("%w: the image is %d×%d; at most 64 megapixels", contract.ErrInvalid, cfg.Width, cfg.Height)
	}

	who, _ := auth.FromContext(ctx)
	now := s.now().UTC()
	name := cleanReferenceName(form.Name)
	if name == "" {
		name = cleanReferenceName(strings.TrimSuffix(form.File.Filename, "."+format))
	}
	m := referenceMeta{
		ID: newAppDataID(now), Owner: who.User, Name: cmp.Or(name, "Reference"), Package: strings.TrimSpace(form.Package),
		ContentType: contentType, Width: cfg.Width, Height: cfg.Height, Placement: Placement{Scale: 1}, CreatedAt: now,
	}
	var thumb []byte
	if form.Thumbnail.IsSet {
		defer form.Thumbnail.Close()
		if b, err := io.ReadAll(io.LimitReader(form.Thumbnail, thumbMaxBytes+1)); err == nil && validThumbnail(b) {
			thumb = b
		}
	}
	return s.saveReference(ctx, m, raw, thumb, nil, nil, 0)
}

// saveReference stores a new image, or a new revision of one that took
// previous bytes, with its metadata within the owner's quota.
func (s *Server) saveReference(ctx context.Context, m referenceMeta, raw, thumb []byte, layers *FigmaLayers, parts [][]byte, previous int64) (ReferenceView, error) {
	user := userDir(m.Owner)
	if quota := s.limits(ctx, m.Owner).ReferencesQuota; quota > 0 {
		entries, err := s.references.list(ctx, user)
		if err != nil {
			return ReferenceView{}, err
		}
		added := int64(len(raw))
		for _, p := range parts {
			added += int64(len(p))
		}
		if s.referenceUsage(entries)-previous+added > quota {
			return ReferenceView{}, errReferenceQuota
		}
	}
	if err := s.references.store.Put(ctx, s.references.key(user, m.ID, ".img"), bytes.NewReader(raw), int64(len(raw))); err != nil {
		return ReferenceView{}, err
	}
	if m.Revision > 0 {
		if err := s.references.removeMatching(ctx, user, m.ID, func(ext string) bool { return strings.HasPrefix(ext, "part-") }); err != nil {
			return ReferenceView{}, err
		}
	}
	size := int64(len(raw))
	for i, p := range parts {
		if err := s.references.store.Put(ctx, s.references.key(user, m.ID, partExt(i)), bytes.NewReader(p), int64(len(p))); err != nil {
			return ReferenceView{}, err
		}
		size += int64(len(p))
	}
	m.Components = len(parts)
	if thumb == nil && m.ContentType != svgType {
		thumb, _ = makeThumbnail(raw)
	}
	if thumb != nil {
		if err := s.references.store.Put(ctx, s.references.key(user, m.ID, ".thumb"), bytes.NewReader(thumb), int64(len(thumb))); err != nil {
			s.log.Warn("reference: storing the thumbnail failed", "reference", m.ID, "err", err)
			thumb = nil
		}
	}
	if layers != nil {
		if err := writeJSON(ctx, s.references.store, s.references.key(user, m.ID, ".layers"), layers); err != nil {
			return ReferenceView{}, err
		}
		m.Layers = len(layers.Layers)
	}
	if err := writeJSON(ctx, s.references.store, s.references.key(user, m.ID, ".json"), m); err != nil {
		if m.Revision == 0 {
			_ = s.references.remove(ctx, user, m.ID)
		}
		return ReferenceView{}, err
	}
	return s.referenceView(m, &referenceEntry{size: size, lastUsed: s.now().UTC(), thumb: thumb != nil}), nil
}

func partExt(i int) string { return fmt.Sprintf(".part-%02d", i) }

func (s *Server) sweepReferences(ctx context.Context) {
	if s.cfg.PixelPerfect.MaxAge <= 0 {
		return
	}
	entries, err := s.references.list(ctx, "")
	if err != nil {
		s.log.Warn("reference retention: list failed", "err", err)
		return
	}
	for _, e := range entries {
		last := e.lastUsed
		if last.IsZero() {
			last = recordingCreated(e.id)
		}
		if s.now().Sub(last) < s.cfg.PixelPerfect.MaxAge {
			continue
		}
		if err := s.references.remove(ctx, e.user, e.id); err != nil {
			s.log.Warn("reference retention: delete failed", "reference", e.id, "err", err)
			continue
		}
		s.log.Info("reference deleted by retention", "reference", e.id)
	}
}

func (s *Server) referencesLoop(ctx context.Context) {
	tick := time.NewTicker(s.cfg.PixelPerfect.SweepInterval)
	defer tick.Stop()
	for {
		s.sweepReferences(ctx)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (s *Server) registerReferences(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "listReferences", Method: http.MethodGet, Path: referencesPath, Tags: tags,
		Description: "The caller's pixel perfect reference images, most recently used first, and the server's rules for them.",
	}, func(ctx context.Context, _ *struct{}) (*out[ReferenceList], error) {
		l := ReferenceList{Items: []ReferenceView{}}
		if s.references == nil {
			return &out[ReferenceList]{l}, nil
		}
		who, _ := auth.FromContext(ctx)
		cfg := s.cfg.PixelPerfect
		l.Enabled, l.Quota, l.MaxAge, l.MaxFileSize = true, s.limits(ctx, who.User).ReferencesQuota, int64(cfg.MaxAge/time.Second), int64(cfg.MaxFileSize)
		ft := s.figmaTokenView(ctx)
		l.FigmaToken, l.FigmaSaved = ft.Server, ft.Saved
		user := userDir(who.User)
		entries, err := s.references.list(ctx, user)
		if err != nil {
			return nil, httpError(err)
		}
		l.Used = s.referenceUsage(entries)
		for _, e := range entries {
			if !e.meta {
				continue
			}
			m, err := readJSON[referenceMeta](ctx, s.references.store, s.references.key(user, e.id, ".json"))
			if err != nil || m.Owner != who.User {
				continue
			}
			l.Items = append(l.Items, s.referenceView(m, e))
		}
		slices.SortFunc(l.Items, func(a, b ReferenceView) int { return b.LastUsedAt.Compare(a.LastUsedAt) })
		return &out[ReferenceList]{l}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "uploadReference", Method: http.MethodPost, Path: referencesPath, Tags: tags,
		DefaultStatus: http.StatusCreated, MaxBodyBytes: int64(s.cfg.PixelPerfect.MaxFileSize) + 1<<20,
		Description: "Adds a reference image (PNG, JPEG, WebP or SVG, at most pixelPerfect.maxFileSize). Fails with 507 when it would go over the caller's quota.",
	}, func(ctx context.Context, in *referenceUploadInput) (*out[ReferenceView], error) {
		v, err := s.uploadReference(ctx, in)
		s.emitResult(ctx, audit.Event{Action: audit.ReferenceUpload, Details: map[string]string{"reference": v.ID, "name": v.Name}}, err)
		if errors.Is(err, errReferenceQuota) {
			return nil, huma.NewError(http.StatusInsufficientStorage, err.Error())
		}
		if err != nil {
			return nil, httpError(err)
		}
		return &out[ReferenceView]{v}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "updateReference", Method: http.MethodPut, Path: referencesPath + "/{id}", Tags: tags,
		Description: "Renames the reference and stores where it sits over the screen and which areas the comparison skips.",
	}, func(ctx context.Context, in *referenceUpdateInput) (*out[ReferenceView], error) {
		m, user, err := s.ownReference(ctx, in.ID)
		if err == nil {
			err = validRects(in.Body.Ignore)
		}
		if err != nil {
			return nil, httpError(err)
		}
		if name := cleanReferenceName(in.Body.Name); name != "" {
			m.Name = name
		}
		m.Placement, m.Ignore = in.Body.Placement, in.Body.Ignore
		if in.Body.Hidden != nil {
			m.Hidden = slices.Compact(slices.Sorted(slices.Values(*in.Body.Hidden)))
		}
		if err := writeJSON(ctx, s.references.store, s.references.key(user, m.ID, ".json"), m); err != nil {
			return nil, httpError(err)
		}
		entries, _ := s.references.list(ctx, user)
		var e *referenceEntry
		for _, it := range entries {
			if it.id == m.ID {
				e = it
			}
		}
		return &out[ReferenceView]{s.referenceView(m, e)}, nil
	})

	s.registerFigma(api)

	huma.Register(api, huma.Operation{
		OperationID: "deleteReference", Method: http.MethodDelete, Path: referencesPath + "/{id}", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *referencePath) (*struct{}, error) {
		m, user, err := s.ownReference(ctx, in.ID)
		if err == nil {
			err = s.references.remove(ctx, user, m.ID)
		}
		s.emitResult(ctx, audit.Event{Action: audit.ReferenceDelete, Details: map[string]string{"reference": in.ID, "name": m.Name}}, err)
		return nil, httpError(err)
	})
}

// serveReferenceImage sends the owner their image and counts it as a use at
// most once an hour, which pushes its retention back.
func (s *Server) serveReferenceImage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	m, user, err := s.ownReference(ctx, r.PathValue("id"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if used, err := s.references.store.Stat(ctx, s.references.key(user, m.ID, ".used")); err != nil || s.now().Sub(used.Modified) > referenceTouch {
		if err := s.references.touch(ctx, user, m.ID); err != nil {
			s.log.Warn("reference: marking as used failed", "reference", m.ID, "err", err)
		}
	}
	etag := `"` + m.ID + "-" + strconv.Itoa(m.Revision) + `"`
	h := w.Header()
	h.Set("ETag", etag)
	h.Set("Cache-Control", "private, no-cache")
	h.Set("X-Content-Type-Options", "nosniff")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	rc, size, err := s.references.store.Get(ctx, s.references.key(user, m.ID, ".img"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer rc.Close()
	h.Set("Content-Type", m.ContentType)
	if m.ContentType == svgType {
		h.Set("Content-Security-Policy", "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:")
	}
	h.Set("Content-Length", strconv.FormatInt(size, 10))
	_, _ = io.Copy(w, rc)
}

// serveReferenceComponent sends the picture of one of a Figma reference's
// components. It doesn't count as a use: the reference's image does.
func (s *Server) serveReferenceComponent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	m, user, err := s.ownReference(ctx, r.PathValue("id"))
	n, nerr := strconv.Atoi(r.PathValue("n"))
	if err != nil || nerr != nil || n < 0 || n >= m.Components {
		http.NotFound(w, r)
		return
	}
	rc, size, err := s.references.store.Get(ctx, s.references.key(user, m.ID, partExt(n)))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer rc.Close()
	h := w.Header()
	h.Set("Content-Type", "image/png")
	h.Set("Content-Length", strconv.FormatInt(size, 10))
	h.Set("Cache-Control", "private, max-age=31536000, immutable")
	h.Set("X-Content-Type-Options", "nosniff")
	_, _ = io.Copy(w, rc)
}

// serveReferenceThumbnail sends the list's picture of a reference, making it
// for a raster image that has none yet. It doesn't count as a use.
func (s *Server) serveReferenceThumbnail(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	m, user, err := s.ownReference(ctx, r.PathValue("id"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	key := s.references.key(user, m.ID, ".thumb")
	var thumb []byte
	if rc, _, err := s.references.store.Get(ctx, key); err == nil {
		thumb, err = io.ReadAll(io.LimitReader(rc, thumbMaxBytes+1))
		rc.Close()
		if err != nil {
			thumb = nil
		}
	}
	if thumb == nil && m.ContentType != svgType {
		if rc, _, err := s.references.store.Get(ctx, s.references.key(user, m.ID, ".img")); err == nil {
			raw, err := io.ReadAll(io.LimitReader(rc, int64(s.cfg.PixelPerfect.MaxFileSize)+1))
			rc.Close()
			if err == nil {
				if b, ok := makeThumbnail(raw); ok {
					thumb = b
					_ = s.references.store.Put(ctx, key, bytes.NewReader(b), int64(len(b)))
				}
			}
		}
	}
	if thumb == nil {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", http.DetectContentType(thumb))
	h.Set("Content-Length", strconv.Itoa(len(thumb)))
	h.Set("Cache-Control", "private, max-age=31536000, immutable")
	h.Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(thumb)
}
