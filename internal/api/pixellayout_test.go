package api

import (
	"net/http"
	"testing"
)

func TestReferenceLayout(t *testing.T) {
	h := newHarness(t, 1)
	v := decode[ReferenceView](t, h.uploadReference("alice", "a.png", testPNG(t, 360, 800), nil))
	if v.Layout.Area.Kind != "screen" || len(v.Layout.Guides) != 0 {
		t.Fatalf("default layout: %+v", v.Layout)
	}
	layout := map[string]any{
		"area":   map[string]any{"kind": "insets", "insets": map[string]any{"top": 24, "right": 0, "bottom": 48, "left": 0}, "box": map[string]any{"x": 0, "y": 0, "w": 0, "h": 0}},
		"grid":   map[string]any{"columns": 4, "margin": 16, "gutter": 8, "baseline": 8},
		"guides": []any{map[string]any{"axis": "x", "pos": 16}},
	}
	put := map[string]any{"name": "a", "placement": v.Placement, "ignore": []any{}, "layout": layout}
	rec := h.do(http.MethodPut, referencesPath+"/"+v.ID, "alice", "", put)
	got := decode[ReferenceView](t, rec)
	if rec.Code != http.StatusOK || got.Layout.Area.Insets.Bottom != 48 || got.Layout.Grid.Columns != 4 || len(got.Layout.Guides) != 1 {
		t.Fatalf("put layout: %d %+v", rec.Code, got.Layout)
	}
	rename := map[string]any{"name": "b", "placement": v.Placement, "ignore": []any{}}
	if got := decode[ReferenceView](t, h.do(http.MethodPut, referencesPath+"/"+v.ID, "alice", "", rename)); got.Layout.Grid.Columns != 4 {
		t.Fatalf("a rename drops the layout: %+v", got.Layout)
	}
	bad := map[string]any{"name": "b", "placement": v.Placement, "ignore": []any{}, "layout": map[string]any{
		"area": map[string]any{"kind": "box", "insets": map[string]any{"top": 0, "right": 0, "bottom": 0, "left": 0}, "box": map[string]any{"x": 0.5, "y": 0, "w": 0.8, "h": 1}},
		"grid": map[string]any{"columns": 0, "margin": 0, "gutter": 0, "baseline": 0}, "guides": []any{},
	}}
	if rec := h.do(http.MethodPut, referencesPath+"/"+v.ID, "alice", "", bad); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("an area outside the screen: %d", rec.Code)
	}
}

func TestLayoutPresets(t *testing.T) {
	h := newHarness(t, 1)
	if p := decode[LayoutPresets](t, h.do(http.MethodGet, layoutPresetsPath, "alice", "", nil)); len(p.Items) != 0 {
		t.Fatalf("empty: %+v", p)
	}
	preset := map[string]any{
		"id": "no-bars", "name": " Without system bars ",
		"area":   map[string]any{"kind": "insets", "insets": map[string]any{"top": 24, "right": 0, "bottom": 48, "left": 0}, "box": map[string]any{"x": 0, "y": 0, "w": 0, "h": 0}},
		"grid":   map[string]any{"columns": 4, "margin": 16, "gutter": 8, "baseline": 0},
		"guides": []any{},
	}
	rec := h.do(http.MethodPut, layoutPresetsPath, "alice", "", map[string]any{"items": []any{preset}})
	if rec.Code != http.StatusOK {
		t.Fatalf("put: %d %s", rec.Code, rec.Body.String())
	}
	p := decode[LayoutPresets](t, h.do(http.MethodGet, layoutPresetsPath, "alice", "", nil))
	if len(p.Items) != 1 || p.Items[0].Name != "Without system bars" || p.Items[0].Area.Insets.Top != 24 {
		t.Fatalf("get: %+v", p)
	}
	if p := decode[LayoutPresets](t, h.do(http.MethodGet, layoutPresetsPath, "bob", "", nil)); len(p.Items) != 0 {
		t.Fatalf("bob sees %+v", p)
	}
	if rec := h.do(http.MethodPut, layoutPresetsPath, "alice", "", map[string]any{"items": []any{preset, preset}}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("duplicate ids: %d", rec.Code)
	}
	if l := h.references("alice"); len(l.Items) != 0 {
		t.Fatalf("presets show up as references: %+v", l.Items)
	}
}
