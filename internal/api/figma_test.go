package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestParseFigmaURL(t *testing.T) {
	for _, tc := range []struct {
		in, key, node string
		ok            bool
	}{
		{"https://www.figma.com/design/AbC123/Shop?node-id=12-34&t=x", "AbC123", "12:34", true},
		{"https://figma.com/file/AbC123/Shop?node-id=12%3A34", "AbC123", "12:34", true},
		{"https://www.figma.com/design/AbC123/branch/Br4nch/Shop?node-id=1-2", "Br4nch", "1:2", true},
		{"https://www.figma.com/proto/AbC123/Shop?node-id=1-2&scaling=min-zoom", "AbC123", "1:2", true},
		{"https://www.figma.com/design/AbC123/Shop", "", "", false},
		{"https://figma.example.com/design/AbC123/Shop?node-id=1-2", "", "", false},
		{"not a link", "", "", false},
	} {
		src, err := parseFigmaURL(tc.in)
		if (err == nil) != tc.ok || src.FileKey != tc.key || src.NodeID != tc.node {
			t.Errorf("parseFigmaURL(%q) = %+v, %v", tc.in, src, err)
		}
	}
}

const figmaFrameJSON = `{"nodes":{"1:2":{"document":{
  "id":"1:2","name":"Checkout","type":"FRAME","absoluteBoundingBox":{"x":100,"y":200,"width":360,"height":800},
  "fills":[{"type":"SOLID","color":{"r":1,"g":1,"b":1,"a":1}}],
  "children":[
    {"id":"1:3","name":"Card","type":"FRAME","absoluteBoundingBox":{"x":116,"y":300,"width":328,"height":120},
     "cornerRadius":12,"layoutMode":"VERTICAL","paddingTop":16,"paddingRight":16,"paddingBottom":16,"paddingLeft":16,"itemSpacing":8,
     "fills":[{"type":"SOLID","color":{"r":0,"g":0.4,"b":1,"a":1},"opacity":0.5}],
     "children":[
       {"id":"1:4","name":"Title","type":"TEXT","characters":"Pay   now","absoluteBoundingBox":{"x":132,"y":316,"width":120,"height":24},
        "style":{"fontFamily":"Roboto","fontWeight":500,"fontSize":16,"lineHeightPx":24.004,"letterSpacing":0.1},
        "fills":[{"type":"SOLID","color":{"r":0.1,"g":0.1,"b":0.1,"a":1}}]},
       {"id":"1:5","name":"Hidden","type":"RECTANGLE","visible":false,"absoluteBoundingBox":{"x":0,"y":0,"width":10,"height":10}}
     ]}
  ]}}}}`

const figmaComponentsJSON = `{"nodes":{"1:20":{"document":{
  "id":"1:20","name":"Player","type":"FRAME","absoluteBoundingBox":{"x":0,"y":0,"width":360,"height":800},
  "fills":[{"type":"SOLID","color":{"r":0,"g":0,"b":0,"a":1}},{"type":"SOLID","color":{"r":1,"g":1,"b":1,"a":1},"opacity":0.5}],
  "children":[
    {"id":"2:1","name":"Status bar","type":"FRAME","absoluteBoundingBox":{"x":0,"y":0,"width":360,"height":24},
     "fills":[{"type":"SOLID","color":{"r":0,"g":0,"b":0,"a":1}}],
     "children":[{"id":"2:9","name":"Clock","type":"TEXT","characters":"12:30","absoluteBoundingBox":{"x":8,"y":4,"width":40,"height":16}}]},
    {"id":"2:2","name":"Stream","type":"RECTANGLE","absoluteBoundingBox":{"x":0,"y":24,"width":360,"height":200},
     "fills":[{"type":"IMAGE","scaleMode":"FILL"}]},
    {"id":"2:3","name":"Content","type":"FRAME","absoluteBoundingBox":{"x":0,"y":224,"width":360,"height":500},"fills":[],
     "children":[
       {"id":"2:4","name":"Title","type":"TEXT","characters":"Live","absoluteBoundingBox":{"x":16,"y":240,"width":100,"height":24}},
       {"id":"2:5","name":"Off","type":"TEXT","visible":false,"absoluteBoundingBox":{"x":16,"y":270,"width":100,"height":24}},
       {"id":"2:6","name":"Pay","type":"INSTANCE","absoluteBoundingBox":{"x":16,"y":600,"width":328,"height":48},
        "fills":[{"type":"SOLID","color":{"r":0,"g":0.4,"b":1,"a":1}}]}
     ]},
    {"id":"2:7","name":"Tab bar","type":"FRAME","absoluteBoundingBox":{"x":0,"y":736,"width":360,"height":64},
     "absoluteRenderBounds":{"x":0,"y":728,"width":360,"height":72},
     "effects":[{"type":"DROP_SHADOW","visible":true}],"fills":[{"type":"SOLID","color":{"r":1,"g":1,"b":1,"a":1}}]}
  ]}}}}`

func fakeFigma(t *testing.T, token string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var renders atomic.Int32
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/render.svg":
			_, _ = w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="800" viewBox="0 0 360 800"><rect width="360" height="800" fill="#fff"/></svg>`))
			return
		case r.URL.Path == "/render.png":
			_, _ = w.Write(testPNG(t, 1080, 2400))
			return
		case r.Header.Get("X-Figma-Token") != token:
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"status":403,"err":"Invalid token"}`))
		case r.URL.Path == "/v1/me":
			_, _ = w.Write([]byte(`{"id":"1","handle":"Ann","email":"ann@example.com"}`))
		case r.URL.Path == "/v1/files/AbC123/nodes" && r.URL.Query().Get("ids") == "1:2":
			_, _ = w.Write([]byte(figmaFrameJSON))
		case r.URL.Path == "/v1/files/AbC123/nodes" && r.URL.Query().Get("ids") == "1:20":
			_, _ = w.Write([]byte(figmaComponentsJSON))
		case r.URL.Path == "/v1/files/AbC123/nodes":
			_, _ = w.Write([]byte(`{"nodes":{"9:9":null}}`))
		case r.URL.Path == "/v1/images/AbC123":
			renders.Add(1)
			ext := r.URL.Query().Get("format")
			images := map[string]string{}
			for id := range strings.SplitSeq(r.URL.Query().Get("ids"), ",") {
				images[id] = srv.URL + "/render." + ext + "?id=" + id
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"err": nil, "images": images})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &renders
}

func TestFigmaImport(t *testing.T) {
	figma, renders := fakeFigma(t, "user-token")
	h := newHarnessWith(t, 1, func(c *Config) { c.PixelPerfect.Figma.URL = figma.URL })
	link := "https://www.figma.com/design/AbC123/Shop?node-id=1-2"

	if l := h.references("alice"); l.FigmaToken {
		t.Fatal("the server has no Figma token")
	}
	rec := h.do(http.MethodPost, referencesPath+"/figma", "alice", "", map[string]any{"url": link})
	if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "personal access token") {
		t.Fatalf("without a token: %d %s", rec.Code, rec.Body.String())
	}
	rec = h.do(http.MethodPost, referencesPath+"/figma", "alice", "", map[string]any{"url": link, "token": "wrong"})
	if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "refused the token") || strings.Contains(rec.Body.String(), "wrong") {
		t.Fatalf("a wrong token: %d %s", rec.Code, rec.Body.String())
	}
	rec = h.do(http.MethodPost, referencesPath+"/figma", "alice", "", map[string]any{"url": "https://www.figma.com/design/AbC123/Shop?node-id=9-9", "token": "user-token"})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("a missing frame: %d %s", rec.Code, rec.Body.String())
	}

	rec = h.do(http.MethodPost, referencesPath+"/figma", "alice", "", map[string]any{"url": link, "token": "user-token", "package": "com.example", "format": "svg"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	v := decode[ReferenceView](t, rec)
	if v.Name != "Checkout" || v.ContentType != "image/svg+xml" || v.Width != 360 || v.Height != 800 || v.Layers != 2 ||
		v.Figma == nil || v.Figma.FileKey != "AbC123" || v.Figma.NodeID != "1:2" || v.Figma.Format != "svg" || v.ThumbURL == "" || v.Package != "com.example" {
		t.Fatalf("view: %+v", v)
	}
	if rec := h.do(http.MethodGet, v.ThumbURL, "alice", "", nil); rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("thumbnail: %d %v", rec.Code, rec.Header())
	}

	rec = h.do(http.MethodGet, referencesPath+"/"+v.ID+"/layers", "alice", "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("layers: %d %s", rec.Code, rec.Body.String())
	}
	l := decode[FigmaLayers](t, rec)
	if l.Width != 360 || l.Height != 800 || len(l.Layers) != 2 {
		t.Fatalf("layers: %+v", l)
	}
	card, title := l.Layers[0], l.Layers[1]
	if card.Name != "Card" || card.Parent != -1 || card.X != 16 || card.Y != 100 || card.W != 328 || card.Fill != "#0066ff80" ||
		len(card.Radius) != 1 || card.Radius[0] != 12 || len(card.Padding) != 4 || card.Gap != 8 || card.Font != nil {
		t.Fatalf("card: %+v", card)
	}
	if title.Parent != 0 || title.Text != "Pay now" || title.Fill != "#1a1a1a" || title.Font == nil || title.Font.Size != 16 || title.Font.LineHeight != 24 || title.Padding != nil {
		t.Fatalf("title: %+v %+v", title, title.Font)
	}
	if rec := h.do(http.MethodGet, referencesPath+"/"+v.ID+"/layers", "bob", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("bob reads the layers: %d", rec.Code)
	}

	put := map[string]any{"name": "Pay", "placement": map[string]any{"x": 3, "y": 4, "scale": 1}, "ignore": []any{}}
	if rec := h.do(http.MethodPut, referencesPath+"/"+v.ID, "alice", "", put); rec.Code != http.StatusOK {
		t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
	}
	before := renders.Load()
	rec = h.do(http.MethodPost, referencesPath+"/"+v.ID+"/figma", "alice", "", map[string]any{"token": "user-token"})
	if rec.Code != http.StatusOK {
		t.Fatalf("refresh: %d %s", rec.Code, rec.Body.String())
	}
	r := decode[ReferenceView](t, rec)
	if r.ID != v.ID || r.Name != "Pay" || r.Placement.X != 3 || r.ImageURL == v.ImageURL || !strings.HasSuffix(r.ImageURL, "?v=1") || renders.Load() == before {
		t.Fatalf("refreshed: %+v", r)
	}
	if got := h.references("alice"); len(got.Items) != 1 || got.Used != r.Size {
		t.Fatalf("after refresh: %+v", got)
	}

	plain := decode[ReferenceView](t, h.uploadReference("alice", "a.png", testPNG(t, 10, 10), nil))
	if rec := h.do(http.MethodPost, referencesPath+"/"+plain.ID+"/figma", "alice", "", map[string]any{"token": "user-token"}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("refresh an upload: %d", rec.Code)
	}
	if rec := h.do(http.MethodGet, referencesPath+"/"+plain.ID+"/layers", "alice", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("layers of an upload: %d", rec.Code)
	}
	if rec := h.do(http.MethodDelete, referencesPath+"/"+v.ID, "alice", "", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	if rec := h.do(http.MethodGet, referencesPath+"/"+v.ID+"/layers", "alice", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("layers after delete: %d", rec.Code)
	}
}

func TestFigmaServerTokenAndPNG(t *testing.T) {
	figma, _ := fakeFigma(t, "server-token")
	t.Setenv("TEST_FIGMA_TOKEN", "server-token")
	h := newHarnessWith(t, 1, func(c *Config) {
		c.PixelPerfect.Figma.URL = figma.URL
		c.PixelPerfect.Figma.Token = "env:TEST_FIGMA_TOKEN"
	})
	if !h.references("alice").FigmaToken {
		t.Fatal("the server's token isn't reported")
	}
	rec := h.do(http.MethodPost, referencesPath+"/figma", "alice", "", map[string]any{
		"url": "https://www.figma.com/design/AbC123/Shop?node-id=1-2", "format": "png", "name": "Checkout 3x",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	v := decode[ReferenceView](t, rec)
	if v.ContentType != "image/png" || v.Width != 1080 || v.Height != 2400 || v.Name != "Checkout 3x" || v.Figma.Format != "png" || v.Layers != 2 {
		t.Fatalf("view: %+v", v)
	}
}

func TestFigmaTokenWithAccount(t *testing.T) {
	figma, _ := fakeFigma(t, "figd_user-token-abcd")
	t.Setenv("TEST_SESSION_KEY", strings.Repeat("k", 40))
	h := newHarnessWith(t, 1, func(c *Config) {
		c.PixelPerfect.Figma.URL = figma.URL
		c.Auth.SessionKey = "env:TEST_SESSION_KEY"
	})
	if v := decode[FigmaTokenView](t, h.do(http.MethodGet, figmaTokenPath, "alice", "", nil)); v.Storage != "browser" || v.Saved {
		t.Fatalf("in memory: %+v", v)
	}
	rec := h.do(http.MethodPut, figmaTokenPath, "alice", "", map[string]any{"token": "figd_user-token-abcd"})
	if v := decode[FigmaTokenView](t, rec); rec.Code != http.StatusOK || v.Saved || v.Handle != "Ann (ann@example.com)" || v.Hint != "abcd" {
		t.Fatalf("checked in memory: %d %+v", rec.Code, v)
	}

	h.srv.cfg.Database.Type = "sqlite"
	if rec := h.do(http.MethodPut, figmaTokenPath, "alice", "", map[string]any{"token": "figd_wrong-token"}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a wrong token: %d %s", rec.Code, rec.Body.String())
	}
	rec = h.do(http.MethodPut, figmaTokenPath, "alice", "", map[string]any{"token": " figd_user-token-abcd "})
	if v := decode[FigmaTokenView](t, rec); rec.Code != http.StatusOK || !v.Saved || v.Storage != "account" || v.UpdatedAt == nil {
		t.Fatalf("save: %d %+v", rec.Code, v)
	}
	if strings.Contains(h.do(http.MethodGet, figmaTokenPath, "alice", "", nil).Body.String(), "user-token") {
		t.Fatal("the token is sent back")
	}
	if l := h.references("alice"); !l.FigmaSaved || l.FigmaToken {
		t.Fatalf("list: %+v", l)
	}
	if v := decode[FigmaTokenView](t, h.do(http.MethodGet, figmaTokenPath, "bob", "", nil)); v.Saved {
		t.Fatal("bob sees alice's token")
	}

	link := "https://www.figma.com/design/AbC123/Shop?node-id=1-2"
	if rec := h.do(http.MethodPost, referencesPath+"/figma", "alice", "", map[string]any{"url": link}); rec.Code != http.StatusCreated {
		t.Fatalf("import with the saved token: %d %s", rec.Code, rec.Body.String())
	}
	if rec := h.do(http.MethodPost, referencesPath+"/figma", "bob", "", map[string]any{"url": link}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("bob imports without a token: %d", rec.Code)
	}

	if rec := h.do(http.MethodDelete, figmaTokenPath, "alice", "", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	if rec := h.do(http.MethodPost, referencesPath+"/figma", "alice", "", map[string]any{"url": link}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("import after delete: %d", rec.Code)
	}
}

func TestFigmaComponents(t *testing.T) {
	figma, _ := fakeFigma(t, "user-token")
	h := newHarnessWith(t, 1, func(c *Config) { c.PixelPerfect.Figma.URL = figma.URL })
	rec := h.do(http.MethodPost, referencesPath+"/figma", "alice", "", map[string]any{
		"url": "https://www.figma.com/design/AbC123/Shop?node-id=1-20", "token": "user-token",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	v := decode[ReferenceView](t, rec)
	if v.ContentType != "image/png" || v.Components != 5 || v.Figma.Scale != 4 || len(v.Hidden) != 0 {
		t.Fatalf("view: %+v %+v", v, v.Figma)
	}
	l := decode[FigmaLayers](t, h.do(http.MethodGet, referencesPath+"/"+v.ID+"/layers", "alice", "", nil))
	var names []string
	for _, c := range l.Components {
		names = append(names, c.Name)
	}
	if strings.Join(names, ",") != "Status bar,Stream,Title,Pay,Tab bar" {
		t.Fatalf("components: %v", names)
	}
	if !l.Composable || l.Background != "#808080" || l.Scale != 4 {
		t.Fatalf("layers: composable %v background %q scale %v", l.Composable, l.Background, l.Scale)
	}
	byName := map[string]FigmaComponent{}
	for _, c := range l.Components {
		byName[c.Name] = c
	}
	if !byName["Stream"].Live || byName["Status bar"].Live || byName["Tab bar"].Y != 728 || byName["Tab bar"].H != 72 || byName["Stream"].Layer < 0 {
		t.Fatalf("components: %+v", l.Components)
	}
	if rec := h.do(http.MethodGet, l.Components[1].URL, "alice", "", nil); rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("component picture: %d", rec.Code)
	}
	if rec := h.do(http.MethodGet, l.Components[1].URL, "bob", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("bob's component picture: %d", rec.Code)
	}
	if rec := h.do(http.MethodGet, referencesPath+"/"+v.ID+"/components/9", "alice", "", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("missing component: %d", rec.Code)
	}
	if used := h.references("alice").Used; used <= int64(len(testPNG(t, 1080, 2400))) {
		t.Fatalf("components aren't counted: %d", used)
	}

	put := map[string]any{"name": v.Name, "placement": v.Placement, "ignore": []any{}, "hidden": []string{"2:2", "2:2", "gone"}}
	rec = h.do(http.MethodPut, referencesPath+"/"+v.ID, "alice", "", put)
	if got := decode[ReferenceView](t, rec); rec.Code != http.StatusOK || strings.Join(got.Hidden, ",") != "2:2,gone" {
		t.Fatalf("hide: %d %+v", rec.Code, got.Hidden)
	}
	rename := map[string]any{"name": "Stream screen", "placement": v.Placement, "ignore": []any{}}
	if got := decode[ReferenceView](t, h.do(http.MethodPut, referencesPath+"/"+v.ID, "alice", "", rename)); strings.Join(got.Hidden, ",") != "2:2,gone" {
		t.Fatalf("a rename drops hidden: %+v", got.Hidden)
	}
	rec = h.do(http.MethodPost, referencesPath+"/"+v.ID+"/figma", "alice", "", map[string]any{"token": "user-token"})
	if got := decode[ReferenceView](t, rec); rec.Code != http.StatusOK || strings.Join(got.Hidden, ",") != "2:2" || got.Components != 5 {
		t.Fatalf("refresh: %d %+v", rec.Code, got)
	}
	if rec := h.do(http.MethodDelete, referencesPath+"/"+v.ID, "alice", "", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	if l := h.references("alice"); l.Used != 0 {
		t.Fatalf("parts left after delete: %d", l.Used)
	}
}

func TestPickComponents(t *testing.T) {
	leaf := func(id string, area float64) figmaNodeDoc {
		return figmaNodeDoc{ID: id, Type: "RECTANGLE", Box: &figmaBox{Width: area, Height: 1}}
	}
	group := func(id string, kids ...figmaNodeDoc) figmaNodeDoc {
		var a float64
		for _, k := range kids {
			a += area(k)
		}
		return figmaNodeDoc{ID: id, Type: "GROUP", Box: &figmaBox{Width: a, Height: 1}, Children: kids}
	}
	ids := func(ns []figmaNodeDoc) string {
		var out []string
		for _, n := range ns {
			out = append(out, n.ID)
		}
		return strings.Join(out, ",")
	}
	frame := figmaNodeDoc{Children: []figmaNodeDoc{
		leaf("a", 5),
		group("big", leaf("b1", 50), group("b2", leaf("b21", 10), leaf("b22", 10))),
		group("small", leaf("s1", 1), leaf("s2", 1)),
	}}
	for _, tc := range []struct {
		max  int
		want string
	}{
		{3, "a,big,small"},
		{4, "a,b1,b2,small"},
		{5, "a,b1,b21,b22,small"},
		{6, "a,b1,b21,b22,s1,s2"},
		{20, "a,b1,b21,b22,s1,s2"},
		{1, "a,big,small"},
	} {
		if got := ids(pickComponents(frame, tc.max)); got != tc.want {
			t.Errorf("max %d: %s, want %s", tc.max, got, tc.want)
		}
	}
}
