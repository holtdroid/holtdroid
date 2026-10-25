package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMapProxy(t *testing.T) {
	var gotUA, gotCookie, gotPath string
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA, gotCookie, gotPath = r.UserAgent(), r.Header.Get("Cookie"), r.URL.EscapedPath()
		switch {
		case r.URL.Path == "/styles/liberty":
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Cache-Control", "max-age=3600")
			_, _ = w.Write([]byte(`{"sources":{"v":{"url":"` + upstream.URL + `/planet"}},"glyphs":"` + upstream.URL + `/fonts/{fontstack}/{range}.pbf"}`))
		case strings.HasPrefix(r.URL.Path, "/planet/"):
			w.Header().Set("Content-Type", "application/x-protobuf")
			_, _ = w.Write([]byte("tile"))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)
	h := newHarnessWith(t, 1, func(c *Config) { c.Map = MapConfig{URL: upstream.URL, Style: "styles/liberty"} })

	rec := h.do(http.MethodGet, "/api/v1/map", "alice", "", nil)
	var view MapView
	if err := json.Unmarshal(rec.Body.Bytes(), &view); err != nil || !view.Enabled || view.Style != "/api/v1/map/tiles/styles/liberty" || view.DarkStyle != view.Style {
		t.Fatalf("map view = %d %s", rec.Code, rec.Body)
	}

	r := httptest.NewRequest(http.MethodGet, "/api/v1/map/tiles/styles/liberty", nil)
	r.Header.Set("Remote-User", "alice")
	r.Header.Set("Cookie", "session=secret")
	style := httptest.NewRecorder()
	h.handler.ServeHTTP(style, r)
	want := `{"sources":{"v":{"url":"/api/v1/map/tiles/planet"}},"glyphs":"/api/v1/map/tiles/fonts/{fontstack}/{range}.pbf"}`
	if style.Code != http.StatusOK || style.Body.String() != want || style.Header().Get("Cache-Control") != "max-age=3600" {
		t.Fatalf("style = %d %s %v", style.Code, style.Body, style.Header())
	}
	if gotCookie != "" || !strings.HasPrefix(gotUA, "holtdroid") {
		t.Fatalf("upstream saw cookie %q, user agent %q", gotCookie, gotUA)
	}

	tile := h.do(http.MethodGet, "/api/v1/map/tiles/planet/1/2/3.pbf", "alice", "", nil)
	if tile.Code != http.StatusOK || tile.Body.String() != "tile" || gotPath != "/planet/1/2/3.pbf" {
		t.Fatalf("tile = %d %s via %s", tile.Code, tile.Body, gotPath)
	}

	if rec := h.do(http.MethodGet, "/api/v1/map/tiles/fonts/Noto%20Sans%20Regular/0-255.pbf", "alice", "", nil); rec.Code != http.StatusNotFound || gotPath != "/fonts/Noto%20Sans%20Regular/0-255.pbf" {
		t.Fatalf("glyphs = %d via %s", rec.Code, gotPath)
	}
	if rec := h.do(http.MethodGet, "/api/v1/map/tiles/planet/1/2/3.pbf", "", "", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous tile = %d", rec.Code)
	}

	off := newHarnessWith(t, 1, func(c *Config) { c.Map = MapConfig{} })
	if rec := off.do(http.MethodGet, "/api/v1/map", "alice", "", nil); !strings.Contains(rec.Body.String(), `"enabled":false`) {
		t.Fatalf("disabled map view = %s", rec.Body)
	}
	if rec := off.do(http.MethodGet, "/api/v1/map/tiles/planet/1/2/3.pbf", "alice", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("disabled tile = %d", rec.Code)
	}
}
