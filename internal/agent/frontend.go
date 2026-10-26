package agent

import (
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
	"time"

	"golang.org/x/sync/singleflight"
)

var errUpstreamNotFound = errors.New("not found upstream")

// Frontend serves the DevTools frontend for a Chromium revision from an
// on-disk cache, fetching missing files from upstream. Files of a revision
// never change, so a cached file is served forever.
//
// Upstream answers a file nobody fetched lately after seconds and 503s many
// such requests at once, while DevTools loads hundreds of files on start:
// fetches are capped and retried with backoff.
type Frontend struct {
	upstream string
	dir      string
	hc       *http.Client
	log      *slog.Logger
	sf       singleflight.Group
	slots    chan struct{}
	attempts int
	backoff  time.Duration
}

func NewFrontend(upstream, dir string, log *slog.Logger) *Frontend {
	return &Frontend{
		upstream: strings.TrimRight(upstream, "/") + "/", dir: dir, hc: &http.Client{Timeout: time.Minute}, log: log,
		slots: make(chan struct{}, 6), attempts: 5, backoff: time.Second,
	}
}

type retryableError struct{ error }

var revPathRe = regexp.MustCompile(`^@[0-9a-f]{7,40}$`)

// ServeHTTP handles GET /devtools-frontend/{rev}/{file...}.
func (f *Frontend) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rev, file := r.PathValue("rev"), path.Clean("/"+r.PathValue("file"))
	if !revPathRe.MatchString(rev) || file == "/" {
		http.NotFound(w, r)
		return
	}
	local := filepath.Join(f.dir, rev, filepath.FromSlash(file))
	if _, err := os.Stat(local); err != nil {
		_, err, _ := f.sf.Do(local, func() (any, error) { return nil, f.fetch(r.Context(), rev+file, local) })
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

func (f *Frontend) fetch(ctx context.Context, rel, local string) error {
	ctx = context.WithoutCancel(ctx)
	var err error
	for attempt := range f.attempts {
		if attempt > 0 {
			time.Sleep(f.backoff << (attempt - 1))
		}
		if err = f.fetchOnce(ctx, rel, local); !errors.As(err, new(retryableError)) {
			return err
		}
	}
	return err
}

func (f *Frontend) fetchOnce(ctx context.Context, rel, local string) error {
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
	if err := os.MkdirAll(filepath.Dir(local), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(local), ".part-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, resp.Body); err != nil {
		tmp.Close()
		return retryableError{err}
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), local)
}
