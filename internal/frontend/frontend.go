package frontend

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/holtdroid/holtdroid/internal/storage"
)

var errUpstreamNotFound = errors.New("not found upstream")

const archivePrefix = "devtools-frontend/"

// Cache serves the DevTools frontend for a Chromium revision from an
// on-disk cache, fetching missing files from upstream. Files of a revision
// never change, so a cached file is served forever.
//
// Upstream answers a file nobody fetched lately after seconds and 503s many
// such requests at once, while DevTools loads hundreds of files on start:
// fetches are capped and retried with backoff. A revision crawled to the end
// is archived in the store, where a later process restores it from instead
// of crawling again.
type Cache struct {
	upstream string
	dir      string
	store    storage.Store
	hc       *http.Client
	log      *slog.Logger
	sf       singleflight.Group
	slots    chan struct{}
	crawl    chan struct{}
	warmed   sync.Map
	restored sync.Map
	attempts int
	backoff  time.Duration
}

// New serves files of upstream from dir. store, when not nil, keeps crawled
// revisions as archives under devtools-frontend/.
func New(upstream, dir string, store storage.Store, log *slog.Logger) *Cache {
	return &Cache{
		upstream: strings.TrimRight(upstream, "/") + "/", dir: dir, store: store, hc: &http.Client{Timeout: time.Minute}, log: log,
		slots: make(chan struct{}, 6), crawl: make(chan struct{}, 3), attempts: 5, backoff: time.Second,
	}
}

type retryableError struct{ error }

var revPathRe = regexp.MustCompile(`^@[0-9a-f]{7,40}$`)

// ServeHTTP handles GET /devtools-frontend/{rev}/{file...}.
func (f *Cache) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rev, file := r.PathValue("rev"), path.Clean("/"+r.PathValue("file"))
	if !revPathRe.MatchString(rev) || file == "/" {
		http.NotFound(w, r)
		return
	}
	f.restore(r.Context(), rev)
	f.Warm(rev)
	local := filepath.Join(f.dir, rev, filepath.FromSlash(file))
	if _, err := os.Stat(local); err != nil {
		_, err, _ := f.sf.Do(local, func() (any, error) { return nil, f.fetch(r.Context(), rev+file, local, false) })
		switch {
		case errors.Is(err, errUpstreamNotFound):
			http.NotFound(w, r)
			return
		case err != nil:
			f.log.Warn("devtools frontend unavailable", "file", rev+file, "err", err)
			http.Error(w, "devtools frontend unavailable", http.StatusBadGateway)
			return
		}
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, local)
}

// fetch takes one of 6 upstream slots; a crawl takes at most 3 of them, so
// the browser's own requests always get the rest.
func (f *Cache) fetch(ctx context.Context, rel, local string, crawl bool) error {
	ctx = context.WithoutCancel(ctx)
	var err error
	for attempt := range f.attempts {
		if attempt > 0 {
			time.Sleep(f.backoff << (attempt - 1))
		}
		if err = f.fetchOnce(ctx, rel, local, crawl); !errors.As(err, new(retryableError)) {
			return err
		}
	}
	return err
}

func (f *Cache) fetchOnce(ctx context.Context, rel, local string, crawl bool) error {
	if crawl {
		f.crawl <- struct{}{}
		defer func() { <-f.crawl }()
	}
	f.slots <- struct{}{}
	defer func() { <-f.slots }()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, f.upstream+rel, nil)
	if err != nil {
		return err
	}
	resp, err := f.hc.Do(req)
	if err != nil {
		return retryableError{err}
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
	case resp.StatusCode == http.StatusNotFound:
		return errUpstreamNotFound
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		return retryableError{fmt.Errorf("devtools frontend %s: %s", rel, resp.Status)}
	default:
		return fmt.Errorf("devtools frontend %s: %s", rel, resp.Status)
	}
	if err := writeFile(local, resp.Body); err != nil {
		return retryableError{err}
	}
	return nil
}

func writeFile(local string, r io.Reader) error {
	if err := os.MkdirAll(filepath.Dir(local), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(local), ".part-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, r); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), local)
}

var frontendRefRe = regexp.MustCompile(`["'(]((?:\.{1,2}/)?[\w@./-]+\.(?:js|css|json|html|svg|png|mjs))["')]`)

// Warm makes a revision available in the background: from the store's
// archive when there is one, else by crawling upstream from inspector.html
// through every file it names, and archiving the result.
func (f *Cache) Warm(rev string) {
	if !revPathRe.MatchString(rev) {
		rev = "@" + strings.TrimPrefix(rev, "@")
	}
	if !revPathRe.MatchString(rev) {
		return
	}
	if _, loaded := f.warmed.LoadOrStore(rev, true); loaded {
		return
	}
	go func() {
		ctx := context.Background()
		if f.restore(ctx, rev) {
			return
		}
		if files, complete := f.crawlRev(ctx, rev); complete {
			f.archive(ctx, rev, files)
		}
	}()
}

// restore unpacks the revision's archive from the store, once; true when the
// revision came from the store.
func (f *Cache) restore(ctx context.Context, rev string) bool {
	if f.store == nil {
		return false
	}
	if ok, done := f.restored.Load(rev); done {
		return ok.(bool)
	}
	ok, _, _ := f.sf.Do("restore:"+rev, func() (any, error) {
		ok := f.restoreOnce(ctx, rev)
		f.restored.Store(rev, ok)
		return ok, nil
	})
	return ok.(bool)
}

func (f *Cache) restoreOnce(ctx context.Context, rev string) bool {
	ctx = context.WithoutCancel(ctx)
	rc, _, err := f.store.Get(ctx, archivePrefix+rev+".tar.gz")
	if err != nil {
		if !errors.Is(err, storage.ErrNotExist) {
			f.log.Warn("devtools frontend archive unavailable", "rev", rev, "err", err)
		}
		return false
	}
	defer rc.Close()
	n, err := unpack(rc, filepath.Join(f.dir, rev))
	if err != nil {
		f.log.Warn("devtools frontend archive broken", "rev", rev, "err", err)
		return false
	}
	f.log.Info("devtools frontend restored", "rev", rev, "files", n)
	return true
}

func unpack(r io.Reader, dir string) (int, error) {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return 0, err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	n := 0
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return n, nil
		}
		if err != nil {
			return n, err
		}
		if h.Typeflag != tar.TypeReg {
			continue
		}
		name := path.Clean("/" + h.Name)
		if err := writeFile(filepath.Join(dir, filepath.FromSlash(name)), tr); err != nil {
			return n, err
		}
		n++
	}
}

func (f *Cache) crawlRev(ctx context.Context, rev string) ([]string, bool) {
	var failed atomic.Int32
	seen := map[string]bool{"/inspector.html": true}
	queue := []string{"/inspector.html"}
	var files []string
	for len(queue) > 0 {
		var wg sync.WaitGroup
		var mu sync.Mutex
		var next []string
		for _, file := range queue {
			wg.Go(func() {
				local := filepath.Join(f.dir, rev, filepath.FromSlash(file))
				if _, err := os.Stat(local); err != nil {
					_, err, _ := f.sf.Do(local, func() (any, error) { return nil, f.fetch(ctx, rev+file, local, true) })
					if errors.Is(err, errUpstreamNotFound) {
						return
					}
					if err != nil {
						failed.Add(1)
						return
					}
				}
				mu.Lock()
				defer mu.Unlock()
				files = append(files, file)
				if ext := path.Ext(file); ext != ".js" && ext != ".html" && ext != ".css" && ext != ".mjs" {
					return
				}
				data, err := os.ReadFile(local)
				if err != nil {
					return
				}
				for _, m := range frontendRefRe.FindAllSubmatch(data, -1) {
					ref := string(m[1])
					if strings.Contains(ref, "://") {
						continue
					}
					target := path.Clean(path.Join(path.Dir(file), ref))
					if strings.HasPrefix(ref, "/") {
						target = path.Clean(ref)
					}
					if !strings.HasPrefix(target, "/") || seen[target] {
						continue
					}
					seen[target] = true
					next = append(next, target)
				}
			})
		}
		wg.Wait()
		queue = next
	}
	complete := failed.Load() == 0
	f.log.Info("devtools frontend crawled", "rev", rev, "files", len(files), "failed", failed.Load())
	return files, complete
}

func (f *Cache) archive(ctx context.Context, rev string, files []string) {
	if f.store == nil {
		return
	}
	tmp, err := os.CreateTemp(f.dir, ".archive-*")
	if err != nil {
		f.log.Warn("devtools frontend archive failed", "rev", rev, "err", err)
		return
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if err := pack(tmp, filepath.Join(f.dir, rev), files); err != nil {
		f.log.Warn("devtools frontend archive failed", "rev", rev, "err", err)
		return
	}
	size, err := tmp.Seek(0, io.SeekCurrent)
	if err == nil {
		_, err = tmp.Seek(0, io.SeekStart)
	}
	if err == nil {
		err = f.store.Put(ctx, archivePrefix+rev+".tar.gz", tmp, size)
	}
	if err != nil {
		f.log.Warn("devtools frontend archive failed", "rev", rev, "err", err)
		return
	}
	f.restored.Store(rev, true)
	f.log.Info("devtools frontend archived", "rev", rev, "files", len(files), "bytes", size)
}

func pack(w io.Writer, dir string, files []string) error {
	gz := gzip.NewWriter(w)
	tw := tar.NewWriter(gz)
	for _, file := range files {
		data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(file)))
		if err != nil {
			return err
		}
		if err := tw.WriteHeader(&tar.Header{Name: strings.TrimPrefix(file, "/"), Mode: 0o644, Size: int64(len(data))}); err != nil {
			return err
		}
		if _, err := tw.Write(data); err != nil {
			return err
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}
