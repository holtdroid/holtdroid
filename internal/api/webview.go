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

// WebViewConfig points at the WebView catalog: com.android.webview builds
// from holtdroid-webview-sync and, tagged with their package, builds of
// other WebView providers such as com.google.android.webview. Sidecar tags
// carry the version, milestone, channels, SDK levels and DevTools frontend.
type WebViewConfig struct {
	Storage storage.Config
	// Catalogs are more catalogs listed next to Storage, one per job that
	// fills one, since each job prunes its own prefix.
	Catalogs []storage.Config
}

type WebViewView struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Version   string    `json:"version"`
	Milestone int       `json:"milestone"`
	Package   string    `json:"package" doc:"the WebView provider: com.android.webview (Chromium builds) or com.google.android.webview (Google's, with proprietary codecs)"`
	Channels  []string  `json:"channels" doc:"Android release channels this milestone is on now: stable, beta, dev, canary"`
	MinSDK    int       `json:"minSdk" doc:"the oldest Android API level it works on: the APK's minSdk, or the catalog's requiresSdk when that is higher"`
	ABIs      []string  `json:"abis" doc:"the ABIs it has native code for, from the sidecar's abis tag; empty when the catalog doesn't say"`
	Released  time.Time `json:"released"`
	Size      int64     `json:"size"`
}

type webviewCatalog struct {
	srcs []*source.Source
}

func newWebViewCatalog(ctx context.Context, cfg WebViewConfig, s *Server) (*webviewCatalog, error) {
	var srcs []*source.Source
	for i, c := range append([]storage.Config{cfg.Storage}, cfg.Catalogs...) {
		if c.Type == "" {
			continue
		}
		store, err := storage.New(ctx, c, s.secrets)
		if err != nil {
			if i == 0 {
				return nil, fmt.Errorf("webview.storage: %w", err)
			}
			return nil, fmt.Errorf("webview.catalogs[%d]: %w", i-1, err)
		}
		srcs = append(srcs, source.New(store, true, rules.Rules{}))
	}
	if len(srcs) == 0 {
		return nil, nil
	}
	return &webviewCatalog{srcs: srcs}, nil
}

// webviewKey prefixes the keys of every catalog but the first with its
// index, so the first one's IDs stay as they were.
func webviewKey(i int, key string) string {
	if i == 0 {
		return key
	}
	return strconv.Itoa(i) + ":" + key
}

type webviewBuild struct {
	view     WebViewView
	frontend string
}

const chromiumWebView = "com.android.webview"

func webviewOf(id string, a source.Artifact) (webviewBuild, bool) {
	t := a.Meta.Tags
	version := t["version"]
	if version == "" {
		return webviewBuild{}, false
	}
	milestone, _ := strconv.Atoi(t["milestone"])
	minSDK, _ := strconv.Atoi(t["minSdk"])
	requires, _ := strconv.Atoi(t["requiresSdk"])
	channels, abis := tagList(t["channel"]), tagList(t["abis"])
	return webviewBuild{
		view: WebViewView{
			ID: id, Title: cmp.Or(a.Meta.Title, "WebView "+version), Version: version, Milestone: milestone,
			Package:  cmp.Or(t["package"], chromiumWebView),
			Channels: channels, MinSDK: max(minSDK, requires), ABIs: abis, Released: a.UploadedAt(), Size: a.Size,
		},
		frontend: t["frontend"],
	}, true
}

func tagList(tag string) []string {
	out := []string{}
	for v := range strings.SplitSeq(tag, ",") {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}

func (c *webviewCatalog) list(ctx context.Context) ([]WebViewView, error) {
	out := []WebViewView{}
	if c == nil {
		return out, nil
	}
	for i, src := range c.srcs {
		items, err := src.List(ctx)
		if err != nil {
			return nil, err
		}
		for _, a := range items {
			if b, ok := webviewOf(encodeID(webviewKey(i, a.ID)), a); ok {
				out = append(out, b.view)
			}
		}
	}
	slices.SortFunc(out, func(a, b WebViewView) int {
		return cmp.Or(cmp.Compare(b.Milestone, a.Milestone), strings.Compare(b.Version, a.Version))
	})
	return out, nil
}

func (c *webviewCatalog) get(ctx context.Context, id string) (*source.Source, string, webviewBuild, error) {
	if c == nil {
		return nil, "", webviewBuild{}, fmt.Errorf("%w: no WebView catalog is configured", contract.ErrInvalid)
	}
	key, err := decodeID(id)
	if err != nil {
		return nil, "", webviewBuild{}, fmt.Errorf("%w: WebView %q", contract.ErrNotFound, id)
	}
	src := c.srcs[0]
	if n, rest, ok := strings.Cut(key, ":"); ok {
		if i, err := strconv.Atoi(n); err == nil && i > 0 && i < len(c.srcs) {
			src, key = c.srcs[i], rest
		}
	}
	a, err := src.Get(ctx, key)
	if err != nil {
		return nil, "", webviewBuild{}, fmt.Errorf("WebView %q: %w", id, err)
	}
	b, ok := webviewOf(id, a)
	if !ok {
		return nil, "", webviewBuild{}, fmt.Errorf("%w: WebView %q", contract.ErrNotFound, id)
	}
	return src, key, b, nil
}

// apiLevels are the Android versions virtual devices offer.
var apiLevels = map[string]int{"11": 30, "12": 31, "13": 33, "14": 34, "15": 35, "16": 36}

// webviewFor resolves a launch's WebView choice and keeps only the
// providers that can install it.
func (s *Server) webviewFor(ctx context.Context, id, android string, candidates []string) (*contract.WebViewInstall, []string, error) {
	if id == "" {
		return nil, candidates, nil
	}
	_, _, b, err := s.webviews.get(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	if level, ok := apiLevels[android]; ok && b.view.MinSDK > level {
		return nil, nil, fmt.Errorf("%w: %s needs Android API level %d, Android %s is %d", contract.ErrInvalid, b.view.Title, b.view.MinSDK, android, level)
	}
	var able []string
	for _, name := range candidates {
		if caps, err := s.providers[name].Capabilities(ctx); err == nil && takesWebView(caps, b.view) {
			able = append(able, name)
		}
	}
	if len(able) == 0 {
		return nil, nil, fmt.Errorf("%w: no provider here can install %s %s", contract.ErrInvalid, b.view.Title, b.view.Version)
	}
	return &contract.WebViewInstall{
		URL:      strings.TrimRight(s.cfg.InternalURL, "/") + "/internal/webview/" + b.view.ID,
		Version:  b.view.Version,
		Package:  b.view.Package,
		Frontend: validFrontend(b.frontend),
	}, able, nil
}

// takesWebView: a WebView has to be one of the provider's WebView packages
// and run natively there, since WebView crashes under ARM translation.
func takesWebView(caps contract.Capabilities, w WebViewView) bool {
	return caps.WebView && (len(caps.WebViewPackages) == 0 || slices.Contains(caps.WebViewPackages, w.Package)) && runsNatively(caps.ABIs, w.ABIs)
}

func abiFamily(abi string) string {
	switch {
	case strings.HasPrefix(abi, "x86"):
		return "x86"
	case strings.HasPrefix(abi, "arm"):
		return "arm"
	}
	return abi
}

// runsNatively: one of the APK's ABIs is the device's, of the same family as
// its preferred (first) one.
func runsNatively(device, apk []string) bool {
	if len(apk) == 0 || len(device) == 0 {
		return true
	}
	own := abiFamily(device[0])
	return slices.ContainsFunc(apk, func(abi string) bool { return slices.Contains(device, abi) && abiFamily(abi) == own })
}

func validFrontend(rev string) string {
	if len(rev) != 40 || strings.Trim(rev, "0123456789abcdef") != "" {
		return ""
	}
	return rev
}

func (s *Server) serveInternalWebView(w http.ResponseWriter, r *http.Request) {
	src, key, _, err := s.webviews.get(r.Context(), r.PathValue("id"))
	if err != nil {
		code := http.StatusNotFound
		if !errors.Is(err, contract.ErrNotFound) && !errors.Is(err, contract.ErrInvalid) {
			code = http.StatusBadGateway
		}
		http.Error(w, err.Error(), code)
		return
	}
	rc, size, err := src.Open(r.Context(), key)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", "application/vnd.android.package-archive")
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	_, _ = io.Copy(w, rc)
}
