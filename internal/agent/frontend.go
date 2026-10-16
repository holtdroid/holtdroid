package agent

import (
	"context"
	"errors"
	"fmt"
	"io"
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
type Frontend struct {
	upstream string
	dir      string
	hc       *http.Client
	sf       singleflight.Group
}

func NewFrontend(upstream, dir string) *Frontend {
	return &Frontend{upstream: strings.TrimRight(upstream, "/") + "/", dir: dir, hc: &http.Client{Timeout: time.Minute}}
}

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
			http.Error(w, "devtools frontend unavailable", http.StatusBadGateway)
			return
		}
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, local)
}

func (f *Frontend) fetch(ctx context.Context, rel, local string) error {
	req, err := http.NewRequestWithContext(context.WithoutCancel(ctx), http.MethodGet, f.upstream+rel, nil)
	if err != nil {
		return err
	}
	resp, err := f.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return errUpstreamNotFound
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
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), local)
}
