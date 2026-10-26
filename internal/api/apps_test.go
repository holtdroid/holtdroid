package api

import (
	"net/http"
	"testing"
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
