package agent

import (
	"archive/tar"
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/klauspost/compress/zstd"

	"github.com/kriakiku/holtdroid/internal/contract"
)

func TestPlanExport(t *testing.T) {
	entries := []appDataEntry{
		{path: "/data/data/p/files", size: 100},
		{path: "/data/data/p/cache", size: 50, cache: true},
	}
	tests := []struct {
		name  string
		req   contract.AppDataExport
		info  contract.AppDataInfo
		paths int
		err   error
	}{
		{"data only", contract.AppDataExport{}, contract.AppDataInfo{Size: 100}, 1, nil},
		{"with cache", contract.AppDataExport{Cache: true}, contract.AppDataInfo{Size: 150, Cache: true}, 2, nil},
		{"cache over its limit", contract.AppDataExport{Cache: true, MaxCacheSize: 40}, contract.AppDataInfo{Size: 100}, 1, nil},
		{"cache pushes over the total", contract.AppDataExport{Cache: true, MaxSize: 120}, contract.AppDataInfo{Size: 100}, 1, nil},
		{"data over the total", contract.AppDataExport{Cache: true, MaxSize: 90}, contract.AppDataInfo{}, 0, contract.ErrTooLarge},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info, paths, err := planExport(entries, tt.req)
			if !errors.Is(err, tt.err) || info != tt.info || len(paths) != tt.paths {
				t.Fatalf("got %+v %v %v", info, paths, err)
			}
			if len(paths) > 0 && paths[0] != "data/data/p/files" {
				t.Fatalf("paths %v", paths)
			}
		})
	}
	if _, _, err := planExport(nil, contract.AppDataExport{}); !errors.Is(err, contract.ErrNotFound) {
		t.Fatalf("no data: %v", err)
	}
}

type tarEntry struct {
	name     string
	typ      byte
	uid, gid int
	link     string
}

func buildTar(t *testing.T, entries []tarEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	for _, e := range entries {
		h := &tar.Header{Name: e.name, Typeflag: e.typ, Uid: e.uid, Gid: e.gid, Mode: 0o600, Linkname: e.link, Uname: "u0_a209", Gname: "u0_a209"}
		if e.typ == tar.TypeReg {
			h.Size = 1
		}
		if err := tw.WriteHeader(h); err != nil {
			t.Fatal(err)
		}
		if e.typ == tar.TypeReg {
			_, _ = tw.Write([]byte("x"))
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestAppDataFilter(t *testing.T) {
	const root = "data/data/com.example.shop/"
	raw := buildTar(t, []tarEntry{
		{root + "files/", tar.TypeDir, 10209, 10209, ""},
		{root + "files/a.txt", tar.TypeReg, 10209, 10209, ""},
		{root + "cache/", tar.TypeDir, 10209, 20209, ""},
		{root + "cache/c.bin", tar.TypeReg, 10209, 20209, ""},
		{"data/user_de/0/com.example.shop/files/de.txt", tar.TypeReg, 10209, 10209, ""},
		{root + "lib/libx.so", tar.TypeReg, 1000, 1000, ""},
		{"data/system/packages.xml", tar.TypeReg, 1000, 1000, ""},
		{root + "files/../../../system/evil", tar.TypeReg, 10209, 10209, ""},
		{"/" + root + "files/abs", tar.TypeReg, 10209, 10209, ""},
		{"data/data/com.example.shopper/files/x", tar.TypeReg, 10209, 10209, ""},
		{root + "files/link", tar.TypeSymlink, 10209, 10209, "/system"},
		{root + "files/link/evil", tar.TypeReg, 10209, 10209, ""},
		{root + "files/hard", tar.TypeLink, 10209, 10209, root + "files/a.txt"},
		{root + "files/dev", tar.TypeChar, 0, 0, ""},
	})

	run := func(cache bool) []*tar.Header {
		var out bytes.Buffer
		f := newAppDataFilter("com.example.shop", 10300, cache)
		if err := rewriteTar(bytes.NewReader(raw), &out, f.keep); err != nil {
			t.Fatal(err)
		}
		var got []*tar.Header
		tr := tar.NewReader(&out)
		for {
			h, err := tr.Next()
			if errors.Is(err, io.EOF) {
				return got
			}
			if err != nil {
				t.Fatal(err)
			}
			got = append(got, h)
		}
	}

	names := func(hs []*tar.Header) string {
		var n []string
		for _, h := range hs {
			n = append(n, strings.TrimPrefix(h.Name, root))
		}
		return strings.Join(n, ",")
	}
	got := run(true)
	if want := "files/,files/a.txt,cache/,cache/c.bin,data/user_de/0/com.example.shop/files/de.txt,files/link"; names(got) != want {
		t.Fatalf("kept %s, want %s", names(got), want)
	}
	for _, h := range got {
		wantGID := 10300
		if strings.Contains(h.Name, "/cache/") {
			wantGID = 20300
		}
		if h.Uid != 10300 || h.Gid != wantGID || h.Uname != "" || h.Gname != "" {
			t.Errorf("%s owned by %d:%d (%s:%s)", h.Name, h.Uid, h.Gid, h.Uname, h.Gname)
		}
	}
	if got := run(false); strings.Contains(names(got), "cache") {
		t.Fatalf("cache restored without asking: %s", names(got))
	}
}

func zstdBytes(t *testing.T, raw []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw, _ := zstd.NewWriter(&buf)
	_, _ = zw.Write(raw)
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestAgentAppData(t *testing.T) {
	const root = "data/data/com.example.shop/"
	snapshot := zstdBytes(t, buildTar(t, []tarEntry{
		{root + "files/a.txt", tar.TypeReg, 10209, 10209, ""},
		{root + "cache/c.bin", tar.TypeReg, 10209, 20209, ""},
	}))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(snapshot) }))
	t.Cleanup(srv.Close)

	h := newHarnessWith(t, nil, func(c *Config) { c.AppData = contract.AppDataRestore{URL: srv.URL + "/snap.tar.zst"} })
	h.waitState(contract.StateReady)
	h.dev.mu.Lock()
	restored, shells := h.dev.restored, strings.Join(h.dev.shells, "\n")
	h.dev.appData = buildTar(t, []tarEntry{{root + "files/a.txt", tar.TypeReg, 10234, 10234, ""}})
	h.dev.mu.Unlock()
	if len(restored) != 1 || restored[0].Name != root+"files/a.txt" || restored[0].Uid != 10234 {
		t.Fatalf("restored %+v", restored)
	}
	if !strings.Contains(shells, "chcon -hR 'u:object_r:app_data_file:s0:c234,c256,c512,c768'") {
		t.Fatalf("not relabelled: %s", shells)
	}

	client := contract.NewAgentClient(h.url, nil)
	info, rc, err := client.ExportAppData(t.Context(), contract.AppDataExport{Cache: true, MaxCacheSize: 100 << 10})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(rc)
	rc.Close()
	if err != nil {
		t.Fatal(err)
	}
	if info != (contract.AppDataInfo{Size: 12 << 10}) {
		t.Fatalf("info %+v", info)
	}
	zr, err := zstd.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	if hdr, err := tar.NewReader(zr).Next(); err != nil || hdr.Name != root+"files/a.txt" {
		t.Fatalf("archive %v %v", hdr, err)
	}
	h.dev.mu.Lock()
	shells = strings.Join(h.dev.shells, "\n")
	h.dev.mu.Unlock()
	if !strings.Contains(shells, "tar -cf - --numeric-owner data/data/com.example.shop/files data/data/com.example.shop/shared_prefs 2>/dev/null") {
		t.Fatalf("export command: %s", shells)
	}
	if s := h.waitState(contract.StateReady); s.AppRunning {
		t.Fatalf("app restarted after an export without restart: %+v", s)
	}
}
