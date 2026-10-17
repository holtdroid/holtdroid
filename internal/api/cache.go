package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path"
	"slices"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/kriakiku/holtdroid/internal/apk"
	"github.com/kriakiku/holtdroid/internal/contract"
	src "github.com/kriakiku/holtdroid/internal/source"
	"github.com/kriakiku/holtdroid/internal/storage"
)

type CacheEntry struct {
	Key      string       `json:"key"`
	Source   string       `json:"source"`
	ID       string       `json:"id"`
	Revision string       `json:"revision"`
	Meta     apk.Metadata `json:"meta"`
	HasIcon  bool         `json:"hasIcon"`
	Size     int64        `json:"size"`
	Parser   int          `json:"parser"`
}

const (
	apkObject  = "app.apk"
	iconObject = "icon.png"
	metaObject = "meta.json"
)

// Cache keeps downloaded APKs and their parsed metadata in a Store, one
// prefix per artifact revision, so a replaced file gets a fresh entry.
// meta.json is written last and marks a complete entry.
type Cache struct {
	store    storage.Store
	tmpDir   string
	maxSize  int64
	open     func(ctx context.Context, source, id string) (io.ReadCloser, error)
	openIcon func(ctx context.Context, source, id string) (io.ReadCloser, error)
	log      *slog.Logger

	sf  singleflight.Group
	mu  sync.Mutex
	mem map[string]CacheEntry
}

func NewCache(store storage.Store, maxSize int64, open, openIcon func(ctx context.Context, source, id string) (io.ReadCloser, error)) *Cache {
	return &Cache{
		store:    store,
		tmpDir:   os.TempDir(),
		maxSize:  maxSize,
		open:     open,
		openIcon: openIcon,
		log:      slog.Default().With("component", "cache"),
		mem:      map[string]CacheEntry{},
	}
}

func cacheKey(source, id, rev string) string {
	sum := sha256.Sum256([]byte(source + "\x00" + id + "\x00" + rev))
	return hex.EncodeToString(sum[:12])
}

func (c *Cache) Lookup(ctx context.Context, source, id, rev string) (CacheEntry, bool) {
	return c.LookupKey(ctx, cacheKey(source, id, rev))
}

func (c *Cache) LookupKey(ctx context.Context, key string) (CacheEntry, bool) {
	c.mu.Lock()
	e, ok := c.mem[key]
	c.mu.Unlock()
	if ok {
		return e, true
	}
	rc, _, err := c.store.Get(ctx, path.Join(key, metaObject))
	if err != nil {
		return CacheEntry{}, false
	}
	defer rc.Close()
	if err := json.NewDecoder(rc).Decode(&e); err != nil || e.Key != key || e.Parser != apk.ParserVersion {
		return CacheEntry{}, false
	}
	c.mu.Lock()
	c.mem[key] = e
	c.mu.Unlock()
	return e, true
}

func (c *Cache) OpenAPK(ctx context.Context, key string) (io.ReadCloser, int64, error) {
	if _, ok := c.LookupKey(ctx, key); !ok {
		return nil, 0, storage.ErrNotExist
	}
	_ = c.store.Touch(ctx, path.Join(key, apkObject))
	return c.store.Get(ctx, path.Join(key, apkObject))
}

func (c *Cache) Icon(ctx context.Context, key string) ([]byte, error) {
	if _, ok := c.LookupKey(ctx, key); !ok {
		return nil, storage.ErrNotExist
	}
	rc, _, err := c.store.Get(ctx, path.Join(key, iconObject))
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

func (c *Cache) Ensure(ctx context.Context, source string, a src.Artifact) (CacheEntry, error) {
	key := cacheKey(source, a.ID, a.Revision)
	if e, ok := c.LookupKey(ctx, key); ok {
		cacheRequests.WithLabelValues("hit").Inc()
		return e, nil
	}
	cacheRequests.WithLabelValues("miss").Inc()
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.fetch(context.WithoutCancel(ctx), source, a)
	})
	if err != nil {
		return CacheEntry{}, err
	}
	return v.(CacheEntry), nil
}

func (c *Cache) fetch(ctx context.Context, source string, a src.Artifact) (CacheEntry, error) {
	rc, err := c.open(ctx, source, a.ID)
	if err != nil {
		return CacheEntry{}, err
	}
	defer rc.Close()

	tmp, err := os.CreateTemp(c.tmpDir, "holtdroid-*.apk")
	if err != nil {
		return CacheEntry{}, err
	}
	defer os.Remove(tmp.Name())
	_, err = io.Copy(tmp, rc)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return CacheEntry{}, fmt.Errorf("download %s/%s: %w", source, a.ID, err)
	}

	meta, icon, err := apk.Parse(tmp.Name())
	if err != nil {
		return CacheEntry{}, fmt.Errorf("%w: %s/%s is not a valid APK: %w", contract.ErrInvalid, source, a.ID, err)
	}
	if side := c.sidecarIcon(ctx, source, a.ID); side != nil {
		icon = side
	}
	return c.put(ctx, source, a, tmp.Name(), meta, icon)
}

func (c *Cache) sidecarIcon(ctx context.Context, source, id string) []byte {
	rc, err := c.openIcon(ctx, source, id)
	if err != nil {
		if !errors.Is(err, storage.ErrNotExist) {
			c.log.Warn("cannot read icon sidecar", "source", source, "artifact", id, "err", err)
		}
		return nil
	}
	defer rc.Close()
	raw, err := io.ReadAll(io.LimitReader(rc, apk.MaxIconBytes+1))
	if err == nil {
		raw, err = apk.NormalizeIcon(raw)
	}
	if err != nil {
		c.log.Warn("ignoring icon sidecar", "source", source, "artifact", id, "err", err)
		return nil
	}
	return raw
}

func (c *Cache) put(ctx context.Context, source string, a src.Artifact, file string, meta apk.Metadata, icon []byte) (CacheEntry, error) {
	f, err := os.Open(file)
	if err != nil {
		return CacheEntry{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return CacheEntry{}, err
	}
	key := cacheKey(source, a.ID, a.Revision)
	entry := CacheEntry{Key: key, Source: source, ID: a.ID, Revision: a.Revision, Meta: meta, HasIcon: icon != nil, Size: info.Size(), Parser: apk.ParserVersion}

	if err := c.store.Put(ctx, path.Join(key, apkObject), f, info.Size()); err != nil {
		return CacheEntry{}, fmt.Errorf("store apk: %w", err)
	}
	if icon != nil {
		if err := c.store.Put(ctx, path.Join(key, iconObject), bytes.NewReader(icon), int64(len(icon))); err != nil {
			return CacheEntry{}, fmt.Errorf("store icon: %w", err)
		}
	}
	raw, err := json.Marshal(entry)
	if err != nil {
		return CacheEntry{}, err
	}
	if err := c.store.Put(ctx, path.Join(key, metaObject), bytes.NewReader(raw), int64(len(raw))); err != nil {
		return CacheEntry{}, fmt.Errorf("store metadata: %w", err)
	}

	c.mu.Lock()
	c.mem[key] = entry
	c.mu.Unlock()

	c.evict(ctx)
	return entry, nil
}

type cacheItem struct {
	prefix string
	size   int64
	used   time.Time
	keys   []string
}

func (c *Cache) evict(ctx context.Context) {
	if c.maxSize <= 0 {
		return
	}
	objs, err := c.store.List(ctx, "")
	if err != nil {
		c.log.Warn("cache eviction: list failed", "err", err)
		return
	}
	byPrefix := map[string]*cacheItem{}
	var total int64
	for _, o := range objs {
		if strings.HasPrefix(o.Key, appDataPrefix) {
			continue
		}
		prefix, name := path.Split(o.Key)
		it := byPrefix[prefix]
		if it == nil {
			it = &cacheItem{prefix: prefix}
			byPrefix[prefix] = it
		}
		it.keys = append(it.keys, o.Key)
		it.size += o.Size
		total += o.Size
		if name == apkObject {
			it.used = o.Modified
		}
	}
	items := make([]*cacheItem, 0, len(byPrefix))
	for _, it := range byPrefix {
		items = append(items, it)
	}
	slices.SortFunc(items, func(a, b *cacheItem) int { return a.used.Compare(b.used) })

	for _, it := range items {
		if total <= c.maxSize {
			return
		}
		c.mu.Lock()
		delete(c.mem, path.Clean(it.prefix))
		c.mu.Unlock()
		slices.SortFunc(it.keys, func(a, b string) int {
			if path.Base(a) == metaObject {
				return -1
			}
			if path.Base(b) == metaObject {
				return 1
			}
			return 0
		})
		var errs []error
		for _, key := range it.keys {
			errs = append(errs, c.store.Delete(ctx, key))
		}
		if err := errors.Join(errs...); err != nil {
			c.log.Warn("cache eviction failed", "entry", it.prefix, "err", err)
			continue
		}
		total -= it.size
	}
}
