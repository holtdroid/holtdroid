// Package source lists APKs kept in a storage backend: a local directory or an
// S3 bucket that anything (a Slack syncer, CI, a person, portal uploads) fills
// with *.apk files and optional <name>.apk.meta.json sidecars.
package source

import (
	"bytes"
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/rules"
	"github.com/holtdroid/holtdroid/internal/storage"
)

const (
	MetaSuffix  = ".meta.json"
	IconSuffix  = ".icon.png"
	maxMetaSize = 1 << 20
)

var ErrReadOnly = errors.New("source is read-only")

type Visibility string

const (
	Public  Visibility = "public"
	Private Visibility = "private"
)

// Meta is the optional sidecar next to an APK. Every field is optional;
// unknown fields are ignored.
type Meta struct {
	Title      string            `json:"title,omitempty" doc:"Display name instead of the APK label"`
	Note       string            `json:"note,omitempty" doc:"Short description, e.g. the Slack message text"`
	Changelog  string            `json:"changelog,omitempty" doc:"What changed in this build, plain text or Markdown"`
	UploadedBy string            `json:"uploadedBy,omitempty" doc:"Display name of whoever published the build"`
	UploadedAt time.Time         `json:"uploadedAt,omitzero" doc:"Publication time; defaults to the file's modification time"`
	Link       string            `json:"link,omitempty" doc:"Link back to the origin (message, pipeline, release)"`
	Origin     string            `json:"origin,omitempty" doc:"Where the build came from, e.g. slack, ci, upload"`
	Tags       map[string]string `json:"tags,omitempty" doc:"Free-form labels such as branch, commit, flavor"`
	Owner      string            `json:"owner,omitempty" doc:"Portal user ID that owns the build and may delete it"`
	Visibility Visibility        `json:"visibility,omitempty" enum:"public,private" doc:"private: only the owner and admins see it; default public"`
	Temporary  bool              `json:"temporary,omitempty" doc:"Deleted automatically once unused for uploads.temporaryTTL"`
	LastUsedAt time.Time         `json:"lastUsedAt,omitzero" doc:"When a session last launched or installed it; kept for temporary builds"`
}

// SafeLink keeps only absolute http(s) URLs, so a sidecar can't smuggle a
// javascript: or data: link into the portal.
func SafeLink(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
		return ""
	}
	return u.String()
}

func (m Meta) Private() bool { return m.Visibility != "" && m.Visibility != Public }

type Artifact struct {
	ID           string
	FileName     string
	Size         int64
	Modified     time.Time
	Revision     string
	MetaRevision string
	Meta         Meta
}

func (a Artifact) UploadedAt() time.Time {
	if !a.Meta.UploadedAt.IsZero() {
		return a.Meta.UploadedAt.UTC()
	}
	return a.Modified.UTC()
}

func (a Artifact) LastUsed() time.Time {
	if a.Meta.LastUsedAt.After(a.UploadedAt()) {
		return a.Meta.LastUsedAt.UTC()
	}
	return a.UploadedAt()
}

func (a Artifact) VisibleTo(user string, admin bool) bool {
	return !a.Meta.Private() || admin || (user != "" && user == a.Meta.Owner)
}

func (a Artifact) ManageableBy(user string, admin bool) bool {
	return admin || (user != "" && user == a.Meta.Owner)
}

type Config struct {
	Name         string
	Type         string
	Filesystem   storage.FilesystemConfig
	S3           storage.S3Config
	ReadOnly     bool
	PollInterval time.Duration
	Include      []string
}

func (c Config) Storage() storage.Config {
	return storage.Config{Type: c.Type, Filesystem: c.Filesystem, S3: c.S3}
}

type cachedMeta struct {
	rev  string
	meta Meta
}

type Source struct {
	store    storage.Store
	readOnly bool
	include  rules.Rules
	log      *slog.Logger

	mu    sync.Mutex
	metas map[string]cachedMeta
}

func New(store storage.Store, readOnly bool, include rules.Rules) *Source {
	return &Source{store: store, readOnly: readOnly, include: include, log: slog.Default().With("component", "source"), metas: map[string]cachedMeta{}}
}

func (s *Source) ReadOnly() bool { return s.readOnly }

func isAPK(key string) bool { return strings.HasSuffix(strings.ToLower(key), ".apk") }

func (s *Source) listed(key string) bool { return isAPK(key) && s.include.Match(key) }

func revision(o storage.Object) string {
	raw := o.ETag
	if raw == "" {
		raw = fmt.Sprintf("%d:%d", o.Size, o.Modified.UnixNano())
	}
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:8])
}

func fileName(id string) string { return id[strings.LastIndex(id, "/")+1:] }

func (s *Source) List(ctx context.Context) ([]Artifact, error) {
	objs, err := s.store.List(ctx, "")
	if err != nil {
		return nil, err
	}
	byKey := make(map[string]storage.Object, len(objs))
	for _, o := range objs {
		byKey[o.Key] = o
	}
	out := []Artifact{}
	seen := map[string]bool{}
	for _, o := range objs {
		if !s.listed(o.Key) {
			continue
		}
		var side *storage.Object
		if m, ok := byKey[o.Key+MetaSuffix]; ok {
			side = &m
		}
		out = append(out, s.artifact(ctx, o, side))
		seen[o.Key+MetaSuffix] = true
	}
	s.mu.Lock()
	for key := range s.metas {
		if !seen[key] {
			delete(s.metas, key)
		}
	}
	s.mu.Unlock()
	slices.SortFunc(out, func(a, b Artifact) int {
		return cmp.Or(b.UploadedAt().Compare(a.UploadedAt()), cmp.Compare(a.ID, b.ID))
	})
	return out, nil
}

func (s *Source) Get(ctx context.Context, id string) (Artifact, error) {
	if !s.listed(id) {
		return Artifact{}, fmt.Errorf("%w: %s", contract.ErrNotFound, id)
	}
	o, err := s.store.Stat(ctx, id)
	if errors.Is(err, storage.ErrNotExist) {
		return Artifact{}, fmt.Errorf("%w: %s", contract.ErrNotFound, id)
	}
	if err != nil {
		return Artifact{}, err
	}
	var side *storage.Object
	if m, err := s.store.Stat(ctx, id+MetaSuffix); err == nil {
		side = &m
	} else if !errors.Is(err, storage.ErrNotExist) {
		return Artifact{}, err
	}
	return s.artifact(ctx, o, side), nil
}

func (s *Source) artifact(ctx context.Context, o storage.Object, side *storage.Object) Artifact {
	a := Artifact{ID: o.Key, FileName: fileName(o.Key), Size: o.Size, Modified: o.Modified, Revision: revision(o)}
	if side != nil {
		a.MetaRevision = revision(*side)
		a.Meta = s.meta(ctx, side.Key, a.MetaRevision)
	}
	return a
}

func (s *Source) meta(ctx context.Context, key, rev string) Meta {
	s.mu.Lock()
	c, ok := s.metas[key]
	s.mu.Unlock()
	if ok && c.rev == rev {
		return c.meta
	}
	var m Meta
	rc, _, err := s.store.Get(ctx, key)
	if err != nil {
		s.log.Warn("could not read sidecar", "key", key, "err", err)
		return m
	}
	err = json.NewDecoder(io.LimitReader(rc, maxMetaSize)).Decode(&m)
	_ = rc.Close()
	if err != nil {
		s.log.Warn("ignoring invalid sidecar", "key", key, "err", err)
		m = Meta{}
	}
	m.Link = SafeLink(m.Link)
	s.mu.Lock()
	s.metas[key] = cachedMeta{rev: rev, meta: m}
	s.mu.Unlock()
	return m
}

func (s *Source) Open(ctx context.Context, id string) (io.ReadCloser, int64, error) {
	if !isAPK(id) {
		return nil, 0, fmt.Errorf("%w: %s", contract.ErrNotFound, id)
	}
	rc, size, err := s.store.Get(ctx, id)
	if errors.Is(err, storage.ErrNotExist) {
		return nil, 0, fmt.Errorf("%w: %s", contract.ErrNotFound, id)
	}
	return rc, size, err
}

func (s *Source) OpenIcon(ctx context.Context, id string) (io.ReadCloser, error) {
	if !isAPK(id) {
		return nil, fmt.Errorf("%w: %s", contract.ErrNotFound, id)
	}
	rc, _, err := s.store.Get(ctx, id+IconSuffix)
	return rc, err
}

// Put stores an APK and its sidecar. The sidecar goes first so the APK never
// shows up without its owner and visibility.
func (s *Source) Put(ctx context.Context, id string, r io.Reader, size int64, meta Meta) (Artifact, error) {
	if s.readOnly {
		return Artifact{}, ErrReadOnly
	}
	if !isAPK(id) {
		return Artifact{}, fmt.Errorf("%w: %s is not an .apk name", contract.ErrInvalid, id)
	}
	if err := s.putMeta(ctx, id, meta); err != nil {
		return Artifact{}, err
	}
	if err := s.store.Put(ctx, id, r, size); err != nil {
		_ = s.store.Delete(ctx, id+MetaSuffix)
		return Artifact{}, err
	}
	return s.Get(ctx, id)
}

func (s *Source) SetMeta(ctx context.Context, id string, meta Meta) (Artifact, error) {
	if s.readOnly {
		return Artifact{}, ErrReadOnly
	}
	if _, err := s.Get(ctx, id); err != nil {
		return Artifact{}, err
	}
	if err := s.putMeta(ctx, id, meta); err != nil {
		return Artifact{}, err
	}
	return s.Get(ctx, id)
}

func (s *Source) putMeta(ctx context.Context, id string, meta Meta) error {
	raw, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return s.store.Put(ctx, id+MetaSuffix, bytes.NewReader(raw), int64(len(raw)))
}

func (s *Source) Delete(ctx context.Context, id string) error {
	if s.readOnly {
		return ErrReadOnly
	}
	if _, err := s.Get(ctx, id); err != nil {
		return err
	}
	if err := s.store.Delete(ctx, id); err != nil {
		return err
	}
	if err := s.store.Delete(ctx, id+IconSuffix); err != nil {
		return err
	}
	return s.store.Delete(ctx, id+MetaSuffix)
}
