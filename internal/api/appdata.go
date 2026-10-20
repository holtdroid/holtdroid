package api

import (
	"cmp"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"regexp"
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

// appDataPrefix holds app data in the shared store; a dedicated
// appData.storage keeps it at the root.
const appDataPrefix = "app-data/"

var (
	appDataID      = regexp.MustCompile(`^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{24}$`)
	appDataPackage = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$`)

	errAppDataDisabled = errors.New("app data is turned off on this server")
	errAppDataExport   = errors.New("downloading app data is turned off on this server")
)

type appDataMeta struct {
	ID          string    `json:"id"`
	Owner       string    `json:"owner"`
	Package     string    `json:"package"`
	ArtifactRef string    `json:"artifactRef"`
	Label       string    `json:"label,omitempty"`
	VersionName string    `json:"versionName,omitempty"`
	VersionCode int32     `json:"versionCode,omitempty"`
	Cache       bool      `json:"cache"`
	Size        int64     `json:"size"`
	Compressed  int64     `json:"compressed"`
	Provider    string    `json:"provider"`
	Session     string    `json:"session"`
	CreatedAt   time.Time `json:"createdAt"`
	LastUsedAt  time.Time `json:"lastUsedAt"`
}

// appDataStore keeps snapshots as <user hash>/<package>/<id>.tar.zst with a
// <id>.json written after it; the JSON marks a complete snapshot.
type appDataStore struct {
	store  storage.Store
	prefix string
}

func userDir(user string) string {
	sum := sha256.Sum256([]byte(user))
	return hex.EncodeToString(sum[:16])
}

func (a *appDataStore) dir(user, pkg string) string {
	return a.prefix + userDir(user) + "/" + pkg + "/"
}

func (a *appDataStore) archive(m appDataMeta) string {
	return a.dir(m.Owner, m.Package) + m.ID + ".tar.zst"
}

func (a *appDataStore) metaKey(m appDataMeta) string {
	return a.dir(m.Owner, m.Package) + m.ID + ".json"
}

func (a *appDataStore) read(ctx context.Context, key string) (appDataMeta, error) {
	rc, _, err := a.store.Get(ctx, key)
	if err != nil {
		return appDataMeta{}, err
	}
	defer rc.Close()
	var m appDataMeta
	return m, json.NewDecoder(io.LimitReader(rc, 64<<10)).Decode(&m)
}

func (a *appDataStore) list(ctx context.Context, prefix string) ([]appDataMeta, []storage.Object, error) {
	objs, err := a.store.List(ctx, prefix)
	if err != nil {
		return nil, nil, err
	}
	var metas []appDataMeta
	for _, o := range objs {
		if !strings.HasSuffix(o.Key, ".json") {
			continue
		}
		if m, err := a.read(ctx, o.Key); err == nil {
			metas = append(metas, m)
		}
	}
	slices.SortFunc(metas, func(x, y appDataMeta) int {
		return cmp.Or(y.CreatedAt.Compare(x.CreatedAt), strings.Compare(y.ID, x.ID))
	})
	return metas, objs, nil
}

func (a *appDataStore) get(ctx context.Context, user, pkg, id string) (appDataMeta, error) {
	if !appDataPackage.MatchString(pkg) || !appDataID.MatchString(id) {
		return appDataMeta{}, fmt.Errorf("%w: app data %s/%s", contract.ErrNotFound, pkg, id)
	}
	m, err := a.read(ctx, a.dir(user, pkg)+id+".json")
	if errors.Is(err, storage.ErrNotExist) {
		return appDataMeta{}, fmt.Errorf("%w: app data %s/%s", contract.ErrNotFound, pkg, id)
	}
	if err == nil && (m.Owner != user || m.Package != pkg || m.ID != id) {
		return appDataMeta{}, fmt.Errorf("%w: app data %s/%s", contract.ErrNotFound, pkg, id)
	}
	return m, err
}

func (a *appDataStore) writeMeta(ctx context.Context, m appDataMeta) error {
	raw, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return a.store.Put(ctx, a.metaKey(m), strings.NewReader(string(raw)), int64(len(raw)))
}

func (a *appDataStore) remove(ctx context.Context, m appDataMeta) error {
	if err := a.store.Delete(ctx, a.metaKey(m)); err != nil && !errors.Is(err, storage.ErrNotExist) {
		return err
	}
	if err := a.store.Delete(ctx, a.archive(m)); err != nil && !errors.Is(err, storage.ErrNotExist) {
		return err
	}
	return nil
}

func newAppDataID(now time.Time) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return now.UTC().Format("20060102T150405Z") + "-" + hex.EncodeToString(b)
}

func (s *Server) expires(m appDataMeta) (time.Time, bool) {
	if s.cfg.AppData.MaxAge <= 0 {
		return time.Time{}, false
	}
	return m.LastUsedAt.Add(s.cfg.AppData.MaxAge), true
}

func (s *Server) expired(m appDataMeta) bool {
	at, ok := s.expires(m)
	return ok && !s.now().Before(at)
}

// prune applies the retention rules to one user's snapshots of one app:
// the most recently used appData.keep stay, unless they are too old.
func (s *Server) prune(ctx context.Context, user, pkg string) {
	metas, _, err := s.appData.list(ctx, s.appData.dir(user, pkg))
	if err != nil {
		s.log.Warn("app data retention: list failed", "package", pkg, "err", err)
		return
	}
	slices.SortStableFunc(metas, func(x, y appDataMeta) int { return y.LastUsedAt.Compare(x.LastUsedAt) })
	for i, m := range metas {
		if s.expired(m) || (s.cfg.AppData.Keep > 0 && i >= s.cfg.AppData.Keep) {
			s.dropAppData(ctx, m)
		}
	}
}

func (s *Server) dropAppData(ctx context.Context, m appDataMeta) {
	if err := s.appData.remove(ctx, m); err != nil {
		s.log.Warn("app data retention: delete failed", "package", m.Package, "id", m.ID, "err", err)
		return
	}
	s.log.Info("app data deleted by retention", "owner", m.Owner, "package", m.Package, "id", m.ID)
}

// sweepAppData deletes expired snapshots of every user and archives whose
// JSON never got written.
func (s *Server) sweepAppData(ctx context.Context) {
	metas, objs, err := s.appData.list(ctx, s.appData.prefix)
	if err != nil {
		s.log.Warn("app data retention: list failed", "err", err)
		return
	}
	complete := map[string]bool{}
	for _, m := range metas {
		complete[s.appData.archive(m)] = true
		if s.expired(m) {
			s.dropAppData(ctx, m)
		}
	}
	for _, o := range objs {
		if strings.HasSuffix(o.Key, ".tar.zst") && !complete[o.Key] && s.now().Sub(o.Modified) > time.Hour+s.cfg.AppData.Timeout {
			if err := s.appData.store.Delete(ctx, o.Key); err == nil {
				s.log.Info("deleted an incomplete app data archive", "key", o.Key)
			}
		}
	}
}

func (s *Server) appDataLoop(ctx context.Context) {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		s.sweepAppData(ctx)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// saveAppData snapshots the app of a ready session into its owner's app
// data. A nil error with ok=false means there was nothing to save.
func (s *Server) saveAppData(ctx context.Context, provider string, sess contract.Session, trigger string, restart bool) (appDataMeta, bool, error) {
	if s.appData == nil || sess.State != contract.StateReady || !appDataPackage.MatchString(sess.Package) || sess.Capabilities != nil && !sess.Capabilities.AppData {
		return appDataMeta{}, false, nil
	}
	octx := ctx
	ctx, cancel := context.WithTimeout(ctx, s.cfg.AppData.Timeout)
	defer cancel()
	m, err := s.exportAppData(ctx, provider, sess, restart)
	ctx = context.WithoutCancel(octx)
	ev := audit.Event{
		Action: audit.AppDataSave, Provider: provider, Session: sess.ID, Artifact: sess.ArtifactRef,
		Details: map[string]string{"owner": sess.Owner, "package": sess.Package, "trigger": trigger},
	}
	switch {
	case errors.Is(err, contract.ErrNotFound):
		appDataSaves.WithLabelValues(trigger, "skipped").Inc()
		return appDataMeta{}, false, nil
	case err != nil:
		appDataSaves.WithLabelValues(trigger, "failed").Inc()
		s.emitResult(ctx, ev, err)
		s.log.Warn("could not save app data", "provider", provider, "session", sess.ID, "trigger", trigger, "err", err)
		return appDataMeta{}, false, err
	}
	appDataSaves.WithLabelValues(trigger, "ok").Inc()
	ev.Details["id"], ev.Details["cache"], ev.Details["size"] = m.ID, strconv.FormatBool(m.Cache), strconv.FormatInt(m.Size, 10)
	s.emit(ctx, ev)
	s.log.Info("app data saved", "provider", provider, "session", sess.ID, "owner", sess.Owner, "package", sess.Package, "size", m.Size, "cache", m.Cache)
	s.prune(ctx, sess.Owner, sess.Package)
	return m, true, nil
}

func (s *Server) exportAppData(ctx context.Context, provider string, sess contract.Session, restart bool) (appDataMeta, error) {
	p, err := s.provider(provider)
	if err != nil {
		return appDataMeta{}, err
	}
	u, err := s.agents.get(ctx, sessionKey{provider, sess.ID}, p)
	if err != nil {
		return appDataMeta{}, err
	}
	cfg := s.cfg.AppData
	client := contract.NewAgentClient(u.String(), &http.Client{Transport: s.agentTransport})
	info, rc, err := client.ExportAppData(ctx, contract.AppDataExport{
		Cache: cfg.Cache, MaxCacheSize: int64(cfg.MaxCacheSize), MaxSize: int64(cfg.MaxSize), Restart: restart,
	})
	if err != nil {
		return appDataMeta{}, err
	}
	defer rc.Close()

	tmp, err := os.CreateTemp("", "holtdroid-appdata-*")
	if err != nil {
		return appDataMeta{}, err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	var src io.Reader = rc
	if cfg.MaxSize > 0 {
		src = io.LimitReader(rc, 2*int64(cfg.MaxSize)+1<<20)
	}
	n, err := io.Copy(tmp, src)
	if err != nil {
		return appDataMeta{}, fmt.Errorf("receive app data: %w", err)
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return appDataMeta{}, err
	}

	now := s.now().UTC()
	m := appDataMeta{
		ID: newAppDataID(now), Owner: sess.Owner, Package: sess.Package, ArtifactRef: sess.ArtifactRef,
		Cache: info.Cache, Size: info.Size, Compressed: n, Provider: provider, Session: sess.ID,
		CreatedAt: now, LastUsedAt: now,
	}
	srcName, key, rev := splitRef(sess.ArtifactRef)
	if e, ok := s.cache.Lookup(ctx, srcName, key, rev); ok {
		m.Label, m.VersionName, m.VersionCode = e.Meta.Label, e.Meta.VersionName, e.Meta.VersionCode
	}
	if err := s.appData.store.Put(ctx, s.appData.archive(m), tmp, n); err != nil {
		return appDataMeta{}, err
	}
	if err := s.appData.writeMeta(ctx, m); err != nil {
		_ = s.appData.store.Delete(context.WithoutCancel(ctx), s.appData.archive(m))
		return appDataMeta{}, err
	}
	return m, nil
}

// restoreFor resolves a launch's app data choice into what the agent gets.
func (s *Server) restoreFor(ctx context.Context, user, pkg string, choice *AppDataChoice) (*contract.AppDataRestore, appDataMeta, error) {
	if choice == nil {
		return nil, appDataMeta{}, nil
	}
	if s.appData == nil {
		return nil, appDataMeta{}, errAppDataDisabled
	}
	m, err := s.appData.get(ctx, user, pkg, choice.ID)
	if err != nil {
		return nil, appDataMeta{}, err
	}
	rel := strings.TrimPrefix(s.appData.archive(m), s.appData.prefix)
	return &contract.AppDataRestore{
		URL:   strings.TrimRight(s.cfg.InternalURL, "/") + "/internal/app-data/" + rel,
		Cache: choice.Cache && m.Cache,
	}, m, nil
}

func (s *Server) markAppDataUsed(ctx context.Context, m appDataMeta) {
	m.LastUsedAt = s.now().UTC()
	if err := s.appData.writeMeta(ctx, m); err != nil {
		s.log.Warn("could not mark app data used", "package", m.Package, "id", m.ID, "err", err)
	}
	appDataRestores.Inc()
}

func (s *Server) serveInternalAppData(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if s.appData == nil || !strings.HasSuffix(key, ".tar.zst") || path.Clean(key) != key || strings.HasPrefix(key, "/") || strings.Contains(key, "..") {
		http.NotFound(w, r)
		return
	}
	rc, size, err := s.appData.store.Get(r.Context(), s.appData.prefix+key)
	if errors.Is(err, storage.ErrNotExist) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", "application/zstd")
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	_, _ = io.Copy(w, rc)
}

type AppDataChoice struct {
	ID    string `json:"id" minLength:"1" doc:"a snapshot of the launched app's package"`
	Cache bool   `json:"cache" doc:"also restore its cache, if it has one"`
}

type AppDataView struct {
	ID          string     `json:"id"`
	Package     string     `json:"package"`
	Label       string     `json:"label,omitempty"`
	VersionName string     `json:"versionName,omitempty"`
	VersionCode int32      `json:"versionCode,omitempty"`
	Source      string     `json:"source"`
	ArtifactID  string     `json:"artifactId"`
	IconURL     string     `json:"iconUrl,omitempty"`
	Cache       bool       `json:"cache" doc:"the snapshot includes the app's cache"`
	Size        int64      `json:"size" doc:"bytes on the device, uncompressed"`
	Compressed  int64      `json:"compressed" doc:"bytes stored"`
	CreatedAt   time.Time  `json:"createdAt"`
	LastUsedAt  time.Time  `json:"lastUsedAt"`
	ExpiresAt   *time.Time `json:"expiresAt,omitempty" doc:"when retention deletes it unless it is used again"`
}

type AppDataList struct {
	Enabled bool          `json:"enabled"`
	Cache   bool          `json:"cache" doc:"snapshots may include the app's cache"`
	Export  bool          `json:"export" doc:"snapshots can be downloaded"`
	Keep    int           `json:"keep" doc:"snapshots kept per app, 0 for no limit"`
	MaxAge  int64         `json:"maxAge" doc:"seconds a snapshot is kept after its last use, 0 for no limit"`
	Items   []AppDataView `json:"items"`
}

func (s *Server) appDataView(ctx context.Context, m appDataMeta) AppDataView {
	srcName, key, rev := splitRef(m.ArtifactRef)
	v := AppDataView{
		ID: m.ID, Package: m.Package, Label: m.Label, VersionName: m.VersionName, VersionCode: m.VersionCode,
		Source: srcName, ArtifactID: encodeID(key), Cache: m.Cache, Size: m.Size, Compressed: m.Compressed,
		CreatedAt: m.CreatedAt, LastUsedAt: m.LastUsedAt,
	}
	if e, ok := s.cache.Lookup(ctx, srcName, key, rev); ok {
		v.Label = cmp.Or(e.Meta.Label, v.Label)
		v.IconURL = iconURL(e)
	}
	if at, ok := s.expires(m); ok {
		v.ExpiresAt = &at
	}
	return v
}

type appDataPath struct {
	Package string `path:"package"`
	ID      string `path:"id"`
}

type fileDownload struct {
	ContentType        string `header:"Content-Type"`
	ContentLength      int64  `header:"Content-Length"`
	ContentDisposition string `header:"Content-Disposition"`
	Body               func(huma.Context)
}

func (s *Server) registerAppData(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "listAppData", Method: http.MethodGet, Path: "/api/v1/app-data", Tags: tags,
		Description: "The caller's saved app data, newest first, and the server's rules for it.",
	}, func(ctx context.Context, in *struct {
		Package string `query:"package" doc:"only this app"`
	},
	) (*out[AppDataList], error) {
		cfg := s.cfg.AppData
		l := AppDataList{Items: []AppDataView{}}
		if s.appData == nil {
			return &out[AppDataList]{l}, nil
		}
		l.Enabled, l.Cache, l.Export, l.Keep, l.MaxAge = true, cfg.Cache, cfg.Export, cfg.Keep, int64(cfg.MaxAge/time.Second)
		who, _ := auth.FromContext(ctx)
		prefix := s.appData.prefix + userDir(who.User) + "/"
		if in.Package != "" {
			if !appDataPackage.MatchString(in.Package) {
				return &out[AppDataList]{l}, nil
			}
			prefix = s.appData.dir(who.User, in.Package)
		}
		metas, _, err := s.appData.list(ctx, prefix)
		if err != nil {
			return nil, httpError(err)
		}
		for _, m := range metas {
			if m.Owner == who.User && !s.expired(m) {
				l.Items = append(l.Items, s.appDataView(ctx, m))
			}
		}
		return &out[AppDataList]{l}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "deleteAppData", Method: http.MethodDelete, Path: "/api/v1/app-data/{package}/{id}", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *appDataPath) (*struct{}, error) {
		ev := audit.Event{Action: audit.AppDataDelete, Details: map[string]string{"package": in.Package, "id": in.ID}}
		m, err := s.ownAppData(ctx, in.Package, in.ID)
		if err == nil {
			ev.Artifact = m.ArtifactRef
			err = s.appData.remove(ctx, m)
		}
		s.emitResult(ctx, ev, err)
		return nil, httpError(err)
	})

	huma.Register(api, huma.Operation{
		OperationID: "downloadAppData", Method: http.MethodGet, Path: "/api/v1/app-data/{package}/{id}/download", Tags: tags,
		Description: "The snapshot as a zstd-compressed tar of the app's /data/data and /data/user_de directories.",
		Responses: map[string]*huma.Response{"200": {
			Description: "the archive",
			Content:     map[string]*huma.MediaType{"application/zstd": {Schema: &huma.Schema{Type: "string", Format: "binary"}}},
		}},
	}, func(ctx context.Context, in *appDataPath) (*fileDownload, error) {
		ev := audit.Event{Action: audit.AppDataDownload, Details: map[string]string{"package": in.Package, "id": in.ID}}
		m, err := s.ownAppData(ctx, in.Package, in.ID)
		if err == nil && !s.cfg.AppData.Export {
			err = errAppDataExport
		}
		var rc io.ReadCloser
		var size int64
		if err == nil {
			ev.Artifact = m.ArtifactRef
			rc, size, err = s.appData.store.Get(ctx, s.appData.archive(m))
		}
		s.emitResult(ctx, ev, err)
		if err != nil {
			return nil, httpError(err)
		}
		return &fileDownload{
			ContentType:        "application/zstd",
			ContentLength:      size,
			ContentDisposition: fmt.Sprintf("attachment; filename=%q", m.Package+"-"+m.ID+".tar.zst"),
			Body: func(hc huma.Context) {
				defer rc.Close()
				_, _ = io.Copy(hc.BodyWriter(), rc)
			},
		}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "saveSessionAppData", Method: http.MethodPost, Path: "/api/v1/sessions/{provider}/{id}/app-data", Tags: tags,
		Description: "Saves the app's data now into the session owner's app data. The app is stopped while it is copied and started again.",
	}, func(ctx context.Context, in *sessionPath) (*out[AppDataView], error) {
		if s.appData == nil {
			return nil, httpError(errAppDataDisabled)
		}
		_, sess, err := s.ownedSession(ctx, in.Provider, in.ID)
		if err != nil {
			return nil, httpError(err)
		}
		if sess.State != contract.StateReady {
			return nil, httpError(fmt.Errorf("%w: the session is not ready", contract.ErrInvalid))
		}
		s.activity.Mark(sessionKey{in.Provider, in.ID})
		m, ok, err := s.saveAppData(ctx, in.Provider, sess, "manual", true)
		if err != nil {
			return nil, httpError(err)
		}
		if !ok {
			return nil, httpError(fmt.Errorf("%w: the app has no data yet", contract.ErrNotFound))
		}
		return &out[AppDataView]{s.appDataView(ctx, m)}, nil
	})
}

func (s *Server) ownAppData(ctx context.Context, pkg, id string) (appDataMeta, error) {
	if s.appData == nil {
		return appDataMeta{}, errAppDataDisabled
	}
	who, _ := auth.FromContext(ctx)
	return s.appData.get(ctx, who.User, pkg, id)
}
