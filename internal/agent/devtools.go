package agent

import (
	"bufio"
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

// DevTools discovers DevTools sockets on the device, keeps an adb forward per
// socket and proxies CDP WebSockets to them.
type DevTools struct {
	dev      Device
	log      *slog.Logger
	hc       *http.Client
	fallback Frontends
	dash     string

	mu       sync.Mutex
	sockets  map[string]*devtoolsSocket
	versions map[string]string
}

type devtoolsSocket struct {
	port    int
	pid     int
	process string
	rev     string
	targets []contract.DevToolsTarget
}

// Frontends are the frontend revisions for builds that report none: the
// app's own, for a Chromium browser build, and the installed WebView's.
type Frontends struct {
	Package string
	App     string
	WebView string
}

func (f Frontends) For(pkg string) string {
	app, webview := frontendRev("@"+f.App), frontendRev("@"+f.WebView)
	if pkg != "" && pkg == f.Package {
		return cmp.Or(app, webview)
	}
	return cmp.Or(webview, app)
}

// NewDevTools looks up the commit of a build that reports a bogus revision
// by its version in Chromium Dash at dash; empty skips that.
func NewDevTools(dev Device, fallback Frontends, dash string, log *slog.Logger) *DevTools {
	return &DevTools{
		dev: dev, fallback: fallback, dash: strings.TrimRight(dash, "/"), log: log, hc: &http.Client{Timeout: 3 * time.Second},
		sockets: map[string]*devtoolsSocket{}, versions: map[string]string{},
	}
}

// Run rescans the device's sockets every interval until ctx ends.
func (d *DevTools) Run(ctx context.Context, interval time.Duration) {
	for {
		if err := d.scan(ctx); err != nil && ctx.Err() == nil {
			d.log.Debug("devtools scan", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

func (d *DevTools) scan(ctx context.Context) error {
	out, err := d.dev.Shell(ctx, "cat /proc/net/unix")
	if err != nil {
		return err
	}
	live := parseDevToolsSockets(out)

	d.mu.Lock()
	var gone []string
	for name := range d.sockets {
		if !slices.Contains(live, name) {
			gone = append(gone, name)
		}
	}
	d.mu.Unlock()

	for _, name := range gone {
		d.mu.Lock()
		s := d.sockets[name]
		delete(d.sockets, name)
		d.mu.Unlock()
		_ = d.dev.RemoveForward(ctx, s.port)
	}
	for _, name := range live {
		d.mu.Lock()
		_, known := d.sockets[name]
		d.mu.Unlock()
		if known {
			continue
		}
		port, err := d.dev.Forward(ctx, name)
		if err != nil {
			return err
		}
		s := &devtoolsSocket{port: port, pid: socketPID(name)}
		var v struct {
			Package string `json:"Android-Package"`
			WebKit  string `json:"WebKit-Version"`
			Browser string `json:"Browser"`
		}
		if err := d.getJSON(ctx, port, "/json/version", &v); err == nil {
			s.process = v.Package
			s.rev = cmp.Or(frontendRev(v.WebKit), d.fallback.For(v.Package))
			if s.rev == "" {
				s.rev = d.versionRev(ctx, v.Browser)
			}
		}
		d.mu.Lock()
		d.sockets[name] = s
		d.mu.Unlock()
	}
	return nil
}

func (d *DevTools) socket(name string) (devtoolsSocket, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	s, ok := d.sockets[name]
	if !ok {
		return devtoolsSocket{}, false
	}
	return *s, true
}

func (d *DevTools) Targets(ctx context.Context) ([]contract.DevToolsTarget, error) {
	d.mu.Lock()
	names := make([]string, 0, len(d.sockets))
	for name := range d.sockets {
		names = append(names, name)
	}
	d.mu.Unlock()
	slices.Sort(names)

	items := []contract.DevToolsTarget{}
	for _, name := range names {
		s, ok := d.socket(name)
		if !ok {
			continue
		}
		targets, err := d.list(ctx, name, s)
		if err != nil {
			d.log.Debug("devtools targets, keeping the last list", "socket", name, "err", err)
			items = append(items, s.targets...)
			continue
		}
		d.mu.Lock()
		if live, ok := d.sockets[name]; ok {
			live.targets = targets
		}
		d.mu.Unlock()
		items = append(items, targets...)
	}
	return items, nil
}

// list asks one socket for its targets. A busy WebView can miss the
// timeout while it navigates, so Targets falls back to the last answer
// while the socket exists.
func (d *DevTools) list(ctx context.Context, name string, s devtoolsSocket) ([]contract.DevToolsTarget, error) {
	var list []struct {
		ID                  string `json:"id"`
		Type                string `json:"type"`
		Title               string `json:"title"`
		URL                 string `json:"url"`
		DevtoolsFrontendURL string `json:"devtoolsFrontendUrl"`
	}
	if err := d.getJSON(ctx, s.port, "/json/list", &list); err != nil {
		return nil, err
	}
	out := make([]contract.DevToolsTarget, 0, len(list))
	for _, t := range list {
		out = append(out, contract.DevToolsTarget{
			Socket:      name,
			PID:         s.pid,
			Process:     s.process,
			ID:          t.ID,
			Type:        t.Type,
			Title:       t.Title,
			URL:         t.URL,
			FrontendRev: cmp.Or(frontendRev(t.DevtoolsFrontendURL), s.rev),
		})
	}
	return out, nil
}

func (d *DevTools) getJSON(ctx context.Context, port int, path string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d%s", port, path), nil)
	if err != nil {
		return err
	}
	req.Host = "localhost"
	resp, err := d.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: %s", path, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

// ServeCDP proxies WS /devtools/{socket}/page/{id} to the forwarded socket.
// The DevTools server only accepts Host: localhost and no foreign Origin.
func (d *DevTools) ServeCDP(w http.ResponseWriter, r *http.Request) {
	s, ok := d.socket(r.PathValue("socket"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.Out.URL.Scheme = "http"
			pr.Out.URL.Host = "127.0.0.1:" + strconv.Itoa(s.port)
			pr.Out.URL.Path = "/devtools/page/" + r.PathValue("id")
			pr.Out.URL.RawPath = ""
			pr.Out.URL.RawQuery = ""
			pr.Out.Host = "localhost"
			pr.Out.Header.Del("Origin")
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			d.log.Warn("cdp proxy", "err", err)
			http.Error(w, "devtools target unavailable", http.StatusBadGateway)
		},
	}
	rp.ServeHTTP(w, r)
}

func parseDevToolsSockets(procNetUnix string) []string {
	var names []string
	sc := bufio.NewScanner(strings.NewReader(procNetUnix))
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 8 {
			continue
		}
		path := fields[len(fields)-1]
		name, ok := strings.CutPrefix(path, "@")
		if !ok || !strings.Contains(name, "devtools_remote") || slices.Contains(names, name) {
			continue
		}
		names = append(names, name)
	}
	slices.Sort(names)
	return names
}

var socketPIDRe = regexp.MustCompile(`_(\d+)$`)

func socketPID(name string) int {
	m := socketPIDRe.FindStringSubmatch(name)
	if m == nil {
		return 0
	}
	pid, _ := strconv.Atoi(m[1])
	return pid
}

var revRe = regexp.MustCompile(`@([0-9a-f]{40})\b`)

// frontendRev finds the commit in a WebKit-Version or a frontend URL.
// Builds outside Chromium's release bots report all zeros, which is none,
// and AOSP-built WebViews a 39-digit hash, which is no commit either.
func frontendRev(s string) string {
	m := revRe.FindStringSubmatch(s)
	if m == nil || strings.Trim(m[1], "0") == "" {
		return ""
	}
	return m[1]
}

// versionRev finds the commit of a release build such as Chrome/125.0.6422.113
// in Chromium Dash: AOSP-built WebViews report a revision that is no commit.
func (d *DevTools) versionRev(ctx context.Context, browser string) string {
	_, version, ok := strings.Cut(browser, "/")
	if !ok || d.dash == "" || !versionRe.MatchString(version) {
		return ""
	}
	d.mu.Lock()
	rev, known := d.versions[version]
	d.mu.Unlock()
	if known {
		return rev
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.dash+"/fetch_version?version="+version, nil)
	if err != nil {
		return ""
	}
	resp, err := d.hc.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var out struct {
		Hashes struct {
			Chromium string `json:"chromium"`
		} `json:"hashes"`
	}
	switch resp.StatusCode {
	case http.StatusOK:
		if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out) != nil {
			return ""
		}
		rev = frontendRev("@" + out.Hashes.Chromium)
	case http.StatusNotFound:
	default:
		return ""
	}
	d.mu.Lock()
	d.versions[version] = rev
	d.mu.Unlock()
	return rev
}

var versionRe = regexp.MustCompile(`^\d+\.\d+\.\d+\.\d+$`)
