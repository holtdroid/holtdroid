package connect

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/holtdroid/holtdroid/internal/contract/control"
)

func TestUpdate(t *testing.T) {
	build := []byte("#!/bin/sh\necho newer\n")
	sum := sha256.Sum256(build)
	latest := hex.EncodeToString(sum[:])
	manifest := control.Manifest{Clients: []control.Build{{Platform: Platform(), SHA256: latest}, {Platform: "plan9-386", SHA256: "x"}}}
	served := build
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/connect/manifest.json":
			_ = json.NewEncoder(w).Encode(manifest)
		case "/connect/holtdroid-" + Platform():
			_, _ = w.Write(served)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	cache := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", cache)
	ctx := context.Background()

	hc := srv.Client()
	u, err := CheckUpdate(ctx, hc, srv.URL)
	if err != nil || !u.Available || u.Latest != latest || u.Current == "" || u.Current == latest {
		t.Fatalf("check %+v, %v", u, err)
	}
	path, err := ApplyUpdate(ctx, hc, srv.URL, u)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(path); string(got) != string(build) {
		t.Fatalf("installed %q", got)
	}
	if fi, _ := os.Stat(path); fi.Mode()&0o111 == 0 {
		t.Fatal("the new build isn't executable")
	}
	if dest, _ := os.Readlink(filepath.Join(cache, "holtdroid", "holtdroid")); dest != path {
		t.Fatalf("link points at %q", dest)
	}

	served = []byte("tampered")
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := ApplyUpdate(ctx, hc, srv.URL, u); err == nil {
		t.Fatal("a build with the wrong checksum was installed")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("the bad download was left in place")
	}

	manifest.Clients = []control.Build{{Platform: Platform(), SHA256: u.Current}}
	if u, err := CheckUpdate(ctx, hc, srv.URL); err != nil || u.Available {
		t.Fatalf("up to date reported as %+v, %v", u, err)
	}
	manifest.Clients = nil
	if u, err := CheckUpdate(ctx, hc, srv.URL); err != nil || u.Available {
		t.Fatalf("a portal without builds reported %+v, %v", u, err)
	}
}

func TestPrefs(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	if LoadPrefs().AutoUpdate {
		t.Fatal("auto update on by default")
	}
	if err := SavePrefs(Prefs{AutoUpdate: true}); err != nil {
		t.Fatal(err)
	}
	if !LoadPrefs().AutoUpdate {
		t.Fatal("auto update not saved")
	}
}
