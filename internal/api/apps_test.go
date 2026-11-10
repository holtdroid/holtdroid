package api

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/holtdroid/holtdroid/internal/storage"
)

func TestAppDescriptions(t *testing.T) {
	h := newHarness(t, 1)

	if rec := h.do(http.MethodGet, "/api/v1/apps", "", "", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous list: %d", rec.Code)
	}
	if got := decode[AppList](t, h.do(http.MethodGet, "/api/v1/apps", "alice", "", nil)); len(got.Items) != 0 {
		t.Fatalf("initial list = %+v", got)
	}

	tests := []struct {
		name, pkg, description string
		code                   int
		want                   []AppInfo
	}{
		{"set", "com.example.hello", "  Tests WebViews.\n\nSecond paragraph.  ", http.StatusOK, []AppInfo{{Package: "com.example.hello", Description: "Tests WebViews.\n\nSecond paragraph.", UpdatedBy: "alice"}}},
		{"another", "org.chromium.chrome", "Browser", http.StatusOK, []AppInfo{
			{Package: "com.example.hello", Description: "Tests WebViews.\n\nSecond paragraph.", UpdatedBy: "alice"},
			{Package: "org.chromium.chrome", Description: "Browser", UpdatedBy: "alice"},
		}},
		{"clear", "com.example.hello", " ", http.StatusOK, []AppInfo{{Package: "org.chromium.chrome", Description: "Browser", UpdatedBy: "alice"}}},
		{"invalid package", "..%2Fsecret", "x", http.StatusUnprocessableEntity, []AppInfo{{Package: "org.chromium.chrome", Description: "Browser", UpdatedBy: "alice"}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := h.do(http.MethodPut, "/api/v1/apps/"+tt.pkg, "alice", "", map[string]string{"description": tt.description})
			if rec.Code != tt.code {
				t.Fatalf("put: %d %s", rec.Code, rec.Body.String())
			}
			got := decode[AppList](t, h.do(http.MethodGet, "/api/v1/apps", "bob", "", nil)).Items
			if len(got) != len(tt.want) {
				t.Fatalf("list = %+v, want %+v", got, tt.want)
			}
			for i := range got {
				g, w := got[i], tt.want[i]
				if g.Package != w.Package || g.Description != w.Description || g.UpdatedBy != w.UpdatedBy || g.UpdatedAt.IsZero() {
					t.Fatalf("item %d = %+v, want %+v", i, g, w)
				}
			}
		})
	}
}

func TestAppDescriptionsInTheirOwnStorage(t *testing.T) {
	dir := t.TempDir()
	h := newHarnessWith(t, 1, func(c *Config) {
		c.Apps.Storage = storage.Config{Type: "filesystem", Filesystem: storage.FilesystemConfig{Dir: dir}}
	})
	rec := h.do(http.MethodPut, "/api/v1/apps/org.example.app", "alice", "", map[string]string{"description": "kept"})
	if rec.Code != http.StatusOK {
		t.Fatalf("put %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "apps", "org.example.app.json")); err != nil {
		t.Fatal(err)
	}
	if got := decode[AppList](t, h.do(http.MethodGet, "/api/v1/apps", "bob", "", nil)).Items; len(got) != 1 || got[0].Description != "kept" {
		t.Fatalf("apps %+v", got)
	}
}

func TestPinnedApps(t *testing.T) {
	h := newHarness(t, 1)
	pin := func(pkg string, pinned bool) {
		t.Helper()
		if rec := h.do(http.MethodPut, "/api/v1/apps/"+pkg+"/pin", "alice", "", map[string]bool{"pinned": pinned}); rec.Code != http.StatusOK {
			t.Fatalf("pin: %d %s", rec.Code, rec.Body.String())
		}
	}
	list := func() []AppInfo {
		t.Helper()
		return decode[AppList](t, h.do(http.MethodGet, "/api/v1/apps", "bob", "", nil)).Items
	}
	describe := func(text string) {
		t.Helper()
		if rec := h.do(http.MethodPut, "/api/v1/apps/org.example.app", "alice", "", map[string]string{"description": text}); rec.Code != http.StatusOK {
			t.Fatalf("describe: %d %s", rec.Code, rec.Body.String())
		}
	}

	pin("org.example.app", true)
	if got := list(); len(got) != 1 || !got[0].Pinned || got[0].Description != "" {
		t.Fatalf("pinned without a description: %+v", got)
	}
	describe("About")
	if got := list(); len(got) != 1 || !got[0].Pinned || got[0].Description != "About" {
		t.Fatalf("a description dropped the pin: %+v", got)
	}
	pin("org.example.app", false)
	if got := list(); len(got) != 1 || got[0].Pinned || got[0].Description != "About" {
		t.Fatalf("unpinning dropped the description: %+v", got)
	}
	describe("")
	if got := list(); len(got) != 0 {
		t.Fatalf("an app with nothing left stays: %+v", got)
	}
	pin("org.example.app", true)
	describe("")
	if got := list(); len(got) != 1 || !got[0].Pinned {
		t.Fatalf("clearing the description dropped the pin: %+v", got)
	}
	if rec := h.do(http.MethodPut, "/api/v1/apps/..%2Fsecret/pin", "alice", "", map[string]bool{"pinned": true}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid package: %d", rec.Code)
	}
}
