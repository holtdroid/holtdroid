package frontend

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/storage"
)

func TestFrontendCache(t *testing.T) {
	var hits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.URL.Path != "/serve_rev/@0123456789abcdef/inspector.html" {
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, "<!doctype html>devtools")
	}))
	defer upstream.Close()

	dir := t.TempDir()
	mux := http.NewServeMux()
	mux.Handle("GET /devtools-frontend/{rev}/{file...}", New(upstream.URL+"/serve_rev", dir, nil, slog.New(slog.DiscardHandler)))
	srv := httptest.NewServer(mux)
	defer srv.Close()

	get := func(path string) (int, string) {
		t.Helper()
		resp, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(body)
	}
	for range 2 {
		code, body := get("/devtools-frontend/@0123456789abcdef/inspector.html?wss=x")
		if code != http.StatusOK || body != "<!doctype html>devtools" {
			t.Fatalf("frontend: %d %q", code, body)
		}
	}
	if hits.Load() != 1 {
		t.Fatalf("upstream hits %d, want 1", hits.Load())
	}
	if _, err := os.Stat(filepath.Join(dir, "@0123456789abcdef", "inspector.html")); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		"/devtools-frontend/@0123456789abcdef/missing.js",
		"/devtools-frontend/fake/inspector.html",
		"/devtools-frontend/@0123456789abcdef/..%2F..%2Fetc%2Fpasswd",
	} {
		if code, _ := get(path); code != http.StatusNotFound {
			t.Errorf("%s: %d", path, code)
		}
	}
}

func TestFrontendRetriesAColdUpstream(t *testing.T) {
	var mu sync.Mutex
	tries := map[string]int{}
	var inFlight, peak atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := inFlight.Add(1)
		defer inFlight.Add(-1)
		for p := peak.Load(); n > p && !peak.CompareAndSwap(p, n); p = peak.Load() {
		}
		time.Sleep(5 * time.Millisecond)
		mu.Lock()
		tries[r.URL.Path]++
		try := tries[r.URL.Path]
		mu.Unlock()
		switch {
		case strings.HasSuffix(r.URL.Path, "/down.js"):
			http.Error(w, "overloaded", http.StatusServiceUnavailable)
		case try <= 2:
			http.Error(w, "overloaded", http.StatusServiceUnavailable)
		default:
			_, _ = io.WriteString(w, "ok "+r.URL.Path)
		}
	}))
	defer upstream.Close()

	f := New(upstream.URL+"/serve_rev", t.TempDir(), nil, slog.New(slog.DiscardHandler))
	f.backoff = time.Millisecond
	mux := http.NewServeMux()
	mux.Handle("GET /devtools-frontend/{rev}/{file...}", f)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	var wg sync.WaitGroup
	codes := make([]int, 20)
	for i := range codes {
		wg.Go(func() {
			resp, err := http.Get(srv.URL + "/devtools-frontend/@0123456789abcdef/m" + strconv.Itoa(i) + ".js")
			if err != nil {
				t.Error(err)
				return
			}
			resp.Body.Close()
			codes[i] = resp.StatusCode
		})
	}
	wg.Wait()
	for i, c := range codes {
		if c != http.StatusOK {
			t.Errorf("m%d.js: %d", i, c)
		}
	}
	if p := peak.Load(); p > 6 {
		t.Errorf("%d upstream requests at once, want at most 6", p)
	}
	resp, err := http.Get(srv.URL + "/devtools-frontend/@0123456789abcdef/down.js")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway || tries["/serve_rev/@0123456789abcdef/down.js"] != 5 {
		t.Errorf("upstream down: %d after %d tries", resp.StatusCode, tries["/serve_rev/@0123456789abcdef/down.js"])
	}
}

func TestFrontendWarm(t *testing.T) {
	files := map[string]string{
		"/inspector.html":         `<script type="module" src="./entrypoints/app/app.js"></script>`,
		"/entrypoints/app/app.js": `import "../../core/a.js"; import("../../panels/b/b.js"); x("https://example.com/x.js")`,
		"/core/a.js":              `export const a = 1`,
		"/panels/b/b.js":          `export const b = 2`,
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, ok := files[strings.TrimPrefix(r.URL.Path, "/serve_rev/@0123456789abcdef")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, body)
	}))
	defer upstream.Close()

	dir := t.TempDir()
	f := New(upstream.URL+"/serve_rev", dir, nil, slog.New(slog.DiscardHandler))
	f.Warm("0123456789abcdef")
	f.Warm("@0123456789abcdef")
	for file := range files {
		local := filepath.Join(dir, "@0123456789abcdef", filepath.FromSlash(file))
		deadline := time.Now().Add(5 * time.Second)
		for {
			if _, err := os.Stat(local); err == nil {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("%s was not warmed", file)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func TestFrontendArchivedAndRestoredThroughTheStore(t *testing.T) {
	files := map[string]string{
		"/inspector.html":         `<script type="module" src="./entrypoints/app/app.js"></script>`,
		"/entrypoints/app/app.js": `import "../../core/a.js"; import("../../missing.js")`,
		"/core/a.js":              `export const a = 1`,
	}
	var hits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		body, ok := files[strings.TrimPrefix(r.URL.Path, "/serve_rev/@0123456789abcdef")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, body)
	}))
	defer upstream.Close()
	store, err := storage.NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	first := New(upstream.URL+"/serve_rev", t.TempDir(), store, slog.New(slog.DiscardHandler))
	first.Warm("0123456789abcdef")
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := store.Stat(context.Background(), "devtools-frontend/@0123456789abcdef.tar.gz"); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("revision was not archived")
		}
		time.Sleep(10 * time.Millisecond)
	}
	upstreamHits := hits.Load()

	second := New(upstream.URL+"/serve_rev", t.TempDir(), store, slog.New(slog.DiscardHandler))
	mux := http.NewServeMux()
	mux.Handle("GET /devtools-frontend/{rev}/{file...}", second)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	for _, file := range []string{"/inspector.html", "/core/a.js"} {
		resp, err := http.Get(srv.URL + "/devtools-frontend/@0123456789abcdef" + file)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK || string(body) != files[file] {
			t.Fatalf("%s from the archive: %d %s", file, resp.StatusCode, body)
		}
	}
	if hits.Load() != upstreamHits {
		t.Fatalf("the second cache went upstream %d times", hits.Load()-upstreamHits)
	}
}

func TestFrontendBrowserRequestsDontWaitForTheCrawl(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "ok "+r.URL.Path)
	}))
	defer upstream.Close()

	f := New(upstream.URL+"/serve_rev", t.TempDir(), nil, slog.New(slog.DiscardHandler))
	for range 3 {
		f.crawl <- struct{}{}
	}
	defer func() {
		for range 3 {
			<-f.crawl
		}
	}()
	f.Warm("0123456789abcdef")

	mux := http.NewServeMux()
	mux.Handle("GET /devtools-frontend/{rev}/{file...}", f)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(srv.URL + "/devtools-frontend/@0123456789abcdef/inspector.html")
	if err != nil {
		t.Fatalf("the browser waited for the crawl: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("inspector.html: %d", resp.StatusCode)
	}
}

func TestFrontendStatus(t *testing.T) {
	files := map[string]string{
		"/inspector.html": `<script src="./a.js"></script><script src="./down.js"></script>`,
		"/a.js":           `1`,
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/down.js") {
			http.Error(w, "overloaded", http.StatusServiceUnavailable)
			return
		}
		body, ok := files[strings.TrimPrefix(r.URL.Path, "/serve_rev/@0123456789abcdef")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, body)
	}))
	defer upstream.Close()

	f := New(upstream.URL+"/serve_rev", t.TempDir(), nil, slog.New(slog.DiscardHandler))
	f.backoff = time.Millisecond
	mux := http.NewServeMux()
	mux.Handle("GET /devtools-frontend/{rev}/{file...}", f)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	status := func() Status {
		t.Helper()
		resp, err := http.Get(srv.URL + "/devtools-frontend/@0123456789abcdef")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var st Status
		if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
			t.Fatal(err)
		}
		return st
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		st := status()
		if st.State == StateIncomplete {
			if st.Files != 2 || st.Failed != 1 {
				t.Fatalf("status %+v", st)
			}
			break
		}
		if st.State != StateWarming {
			t.Fatalf("status %+v", st)
		}
		if time.Now().After(deadline) {
			t.Fatal("crawl never finished")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestFrontendCrawlsOneRevisionAtATimeBrowserFirst(t *testing.T) {
	var mu sync.Mutex
	var order []string
	block := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rev := strings.TrimPrefix(strings.Split(r.URL.Path, "/")[2], "@")
		mu.Lock()
		order = append(order, rev)
		mu.Unlock()
		if rev == "aaaaaaaaaaaaaaaa" {
			<-block
		}
		_, _ = io.WriteString(w, "<!doctype html>")
	}))
	defer upstream.Close()

	f := New(upstream.URL+"/serve_rev", t.TempDir(), nil, slog.New(slog.DiscardHandler))
	f.Warm("aaaaaaaaaaaaaaaa")
	deadline := time.Now().Add(2 * time.Second)
	for {
		mu.Lock()
		n := len(order)
		mu.Unlock()
		if n == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("first crawl did not start")
		}
		time.Sleep(time.Millisecond)
	}
	f.Warm("bbbbbbbbbbbbbbbb")
	f.enqueue("cccccccccccccccc", true)
	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	if len(order) != 1 {
		t.Fatalf("crawls ran in parallel: %v", order)
	}
	mu.Unlock()
	close(block)
	deadline = time.Now().Add(2 * time.Second)
	for {
		mu.Lock()
		done := len(order) == 3
		got := slices.Clone(order)
		mu.Unlock()
		if done {
			if got[1] != "cccccccccccccccc" || got[2] != "bbbbbbbbbbbbbbbb" {
				t.Fatalf("order %v, want the browser's revision before the prefetched one", got)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("crawls did not finish: %v", got)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestFrontendArchivesListedAndDeleted(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "<!doctype html>")
	}))
	defer upstream.Close()
	store, err := storage.NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	f := New(upstream.URL+"/serve_rev", t.TempDir(), store, slog.New(slog.DiscardHandler))
	f.Warm("0123456789abcdef")
	deadline := time.Now().Add(5 * time.Second)
	for {
		items, err := f.Archives(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if len(items) == 1 {
			if items[0].Rev != "@0123456789abcdef" || items[0].Size == 0 {
				t.Fatalf("archives %+v", items)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("never archived")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if st := f.Statuses()["@0123456789abcdef"]; st.State != StateReady || st.Files != 1 {
		t.Fatalf("status %+v", st)
	}
	if err := f.Delete(context.Background(), "0123456789abcdef"); err != nil {
		t.Fatal(err)
	}
	items, _ := f.Archives(context.Background())
	if len(items) != 0 {
		t.Fatalf("archives after delete: %+v", items)
	}
	if _, err := os.Stat(filepath.Join(f.dir, "@0123456789abcdef")); err == nil {
		t.Fatal("local files survived the delete")
	}
	if st := f.Status("@0123456789abcdef"); st.State != StateWarming || st.Files != 0 {
		t.Fatalf("status after delete %+v", st)
	}
	if err := f.Delete(context.Background(), "not a rev"); !errors.Is(err, storage.ErrNotExist) {
		t.Fatalf("delete of a bad rev: %v", err)
	}
}
