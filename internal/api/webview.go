package api

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/rules"
	"github.com/holtdroid/holtdroid/internal/source"
	"github.com/holtdroid/holtdroid/internal/storage"
)

// WebViewConfig points at the WebView catalog that holtdroid-webview-sync
// writes: com.android.webview builds with sidecars whose tags carry the
// version, milestone, channels, SDK levels and DevTools frontend revision.
type WebViewConfig struct {
	Storage storage.Config
}

type WebViewView struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Version   string    `json:"version"`
	Milestone int       `json:"milestone"`
	Channels  []string  `json:"channels" doc:"Android release channels this milestone is on now: stable, beta, dev, canary"`
	MinSDK    int       `json:"minSdk" doc:"the oldest Android API level it installs on"`
	Released  time.Time `json:"released"`
	Size      int64     `json:"size"`
}

type webviewCatalog struct {
	src *source.Source
}

func newWebViewCatalog(ctx context.Context, cfg WebViewConfig, s *Server) (*webviewCatalog, error) {
	if cfg.Storage.Type == "" {
		return nil, nil
	}
	store, err := storage.New(ctx, cfg.Storage, s.secrets)
	if err != nil {
		return nil, fmt.Errorf("webview.storage: %w", err)
	}
	return &webviewCatalog{src: source.New(store, true, rules.Rules{})}, nil
}

type webviewBuild struct {
	view     WebViewView
	frontend string
}

func webviewOf(a source.Artifact) (webviewBuild, bool) {
	t := a.Meta.Tags
	version := t["version"]
	if version == "" {
		return webviewBuild{}, false
	}
	milestone, _ := strconv.Atoi(t["milestone"])
	minSDK, _ := strconv.Atoi(t["minSdk"])
	channels := []string{}
	for c := range strings.SplitSeq(t["channel"], ",") {
		if c = strings.TrimSpace(c); c != "" {
			channels = append(channels, c)
		}
	}
	return webviewBuild{
		view: WebViewView{
			ID: encodeID(a.ID), Title: cmp.Or(a.Meta.Title, "WebView "+version), Version: version, Milestone: milestone,
			Channels: channels, MinSDK: minSDK, Released: a.UploadedAt(), Size: a.Size,
		},
		frontend: t["frontend"],
	}, true
}

func (c *webviewCatalog) list(ctx context.Context) ([]WebViewView, error) {
	out := []WebViewView{}
	if c == nil {
		return out, nil
	}
	items, err := c.src.List(ctx)
	if err != nil {
		return nil, err
	}
	for _, a := range items {
		if b, ok := webviewOf(a); ok {
			out = append(out, b.view)
		}
	}
	slices.SortFunc(out, func(a, b WebViewView) int {
		return cmp.Or(cmp.Compare(b.Milestone, a.Milestone), strings.Compare(b.Version, a.Version))
	})
	return out, nil
}

func (c *webviewCatalog) get(ctx context.Context, id string) (string, webviewBuild, error) {
	if c == nil {
		return "", webviewBuild{}, fmt.Errorf("%w: no WebView catalog is configured", contract.ErrInvalid)
	}
	key, err := decodeID(id)
	if err != nil {
		return "", webviewBuild{}, fmt.Errorf("%w: WebView %q", contract.ErrNotFound, id)
	}
	a, err := c.src.Get(ctx, key)
	if err != nil {
		return "", webviewBuild{}, fmt.Errorf("WebView %q: %w", id, err)
	}
	b, ok := webviewOf(a)
	if !ok {
		return "", webviewBuild{}, fmt.Errorf("%w: WebView %q", contract.ErrNotFound, id)
	}
	return key, b, nil
}

// webviewFor resolves a launch's WebView choice and keeps only the
// providers that can install it.
func (s *Server) webviewFor(ctx context.Context, id string, candidates []string) (*contract.WebViewInstall, []string, error) {
	if id == "" {
		return nil, candidates, nil
	}
	_, b, err := s.webviews.get(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	var able []string
	for _, name := range candidates {
		if caps, err := s.providers[name].Capabilities(ctx); err == nil && caps.WebView {
			able = append(able, name)
		}
	}
	if len(able) == 0 {
		return nil, nil, fmt.Errorf("%w: no provider here can change the WebView", contract.ErrInvalid)
	}
	return &contract.WebViewInstall{
		URL:      strings.TrimRight(s.cfg.InternalURL, "/") + "/internal/webview/" + b.view.ID,
		Version:  b.view.Version,
		Frontend: validFrontend(b.frontend),
	}, able, nil
}

func validFrontend(rev string) string {
	if len(rev) != 40 || strings.Trim(rev, "0123456789abcdef") != "" {
		return ""
	}
	return rev
}

func (s *Server) serveInternalWebView(w http.ResponseWriter, r *http.Request) {
	key, _, err := s.webviews.get(r.Context(), r.PathValue("id"))
	if err != nil {
		code := http.StatusNotFound
		if !errors.Is(err, contract.ErrNotFound) && !errors.Is(err, contract.ErrInvalid) {
			code = http.StatusBadGateway
		}
		http.Error(w, err.Error(), code)
		return
	}
	rc, size, err := s.webviews.src.Open(r.Context(), key)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", "application/vnd.android.package-archive")
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	_, _ = io.Copy(w, rc)
}
