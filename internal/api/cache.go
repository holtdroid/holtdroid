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
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/kriakiku/holtdroid/internal/apk"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/storage"
)

type CacheEntry struct {
	Source   string            `json:"source"`
	Artifact contract.Artifact `json:"artifact"`
	Meta     apk.Metadata      `json:"meta"`
	HasIcon  bool              `json:"hasIcon"`
	Size     int64             `json:"size"`
}

const (
	apkObject  = "app.apk"
	iconObject = "icon.png"
	metaObject = "meta.json"
)

// Cache keeps downloaded APKs and their parsed metadata in a Store, one
// prefix per artifact. meta.json is written last and marks a complete entry.
type Cache struct {
	store   storage.Store
	tmpDir  string
	maxSize int64
	open    func(ctx context.Context, source, id string) (contract.Artifact, io.ReadCloser, error)
	log     *slog.Logger

	sf  singleflight.Group
	mu  sync.Mutex
	mem map[string]CacheEntry
}

func NewCache(store storage.Store, maxSize int64, open func(ctx context.Context, source, id string) (contract.Artifact, io.ReadCloser, error)) *Cache {
	return &Cache{
		store:   store,
		tmpDir:  os.TempDir(),
		maxSize: maxSize,
		open:    open,
		log:     slog.Default().With("component", "cache"),
		mem:     map[string]CacheEntry{},
	}
}

func cacheKey(source, id string) string {
	sum := sha256.Sum256([]byte(source + "\x00" + id))
	return hex.EncodeToString(sum[:12])
}

func objectKey(source, id, name string) string { return path.Join(cacheKey(source, id), name) }

func (c *Cache) Lookup(ctx context.Context, source, id string) (CacheEntry, bool) {
	key := cacheKey(source, id)
	c.mu.Lock()
	e, ok := c.mem[key]
	c.mu.Unlock()
	if ok {
		return e, true
	}
	rc, _, err := c.store.Get(ctx, objectKey(source, id, metaObject))
	if err != nil {
		return CacheEntry{}, false
	}
	defer rc.Close()
	if err := json.NewDecoder(rc).Decode(&e); err != nil {
		return CacheEntry{}, false
	}
	c.mu.Lock()
	c.mem[key] = e
	c.mu.Unlock()
	return e, true
}

func (c *Cache) OpenAPK(ctx context.Context, source, id string) (io.ReadCloser, int64, error) {
	_ = c.store.Touch(ctx, objectKey(source, id, apkObject))
	return c.store.Get(ctx, objectKey(source, id, apkObject))
}

func (c *Cache) Icon(ctx context.Context, source, id string) ([]byte, error) {
	rc, _, err := c.store.Get(ctx, objectKey(source, id, iconObject))
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

func (c *Cache) Ensure(ctx context.Context, source, id string) (CacheEntry, error) {
	if e, ok := c.Lookup(ctx, source, id); ok {
		return e, nil
	}
	v, err, _ := c.sf.Do(cacheKey(source, id), func() (any, error) {
		return c.fetch(context.WithoutCancel(ctx), source, id)
	})
	if err != nil {
		return CacheEntry{}, err
	}
	return v.(CacheEntry), nil
}

func (c *Cache) fetch(ctx context.Context, source, id string) (CacheEntry, error) {
	artifact, rc, err := c.open(ctx, source, id)
	if err != nil {
		return CacheEntry{}, err
	}
	defer rc.Close()

	tmp, err := os.CreateTemp(c.tmpDir, "holtdroid-*.apk")
	if err != nil {
		return CacheEntry{}, err
	}
	defer os.Remove(tmp.Name())
	size, err := io.Copy(tmp, rc)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return CacheEntry{}, fmt.Errorf("download %s/%s: %w", source, id, err)
	}

	meta, icon, err := apk.Parse(tmp.Name())
	if err != nil {
		return CacheEntry{}, fmt.Errorf("%w: %s/%s is not a valid APK: %w", contract.ErrInvalid, source, id, err)
	}
	entry := CacheEntry{Source: source, Artifact: artifact, Meta: meta, HasIcon: icon != nil, Size: size}

	f, err := os.Open(tmp.Name())
	if err != nil {
		return CacheEntry{}, err
	}
	err = c.store.Put(ctx, objectKey(source, id, apkObject), f, size)
	_ = f.Close()
	if err != nil {
		return CacheEntry{}, fmt.Errorf("store apk: %w", err)
	}
	if icon != nil {
		if err := c.store.Put(ctx, objectKey(source, id, iconObject), bytes.NewReader(icon), int64(len(icon))); err != nil {
			return CacheEntry{}, fmt.Errorf("store icon: %w", err)
		}
	}
	raw, err := json.Marshal(entry)
	if err != nil {
		return CacheEntry{}, err
	}
	if err := c.store.Put(ctx, objectKey(source, id, metaObject), bytes.NewReader(raw), int64(len(raw))); err != nil {
		return CacheEntry{}, fmt.Errorf("store metadata: %w", err)
	}

	c.mu.Lock()
	c.mem[cacheKey(source, id)] = entry
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
