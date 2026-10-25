package api

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func encodePolyline6(pts []contract.GeoPoint) string {
	var b strings.Builder
	var pLat, pLng int
	enc := func(v int) {
		v <<= 1
		if v < 0 {
			v = ^v
		}
		for v >= 0x20 {
			b.WriteByte(byte((0x20 | (v & 0x1f)) + 63))
			v >>= 5
		}
		b.WriteByte(byte(v + 63))
	}
	for _, p := range pts {
		lat, lng := int(math.Round(p.Latitude*1e6)), int(math.Round(p.Longitude*1e6))
		enc(lat - pLat)
		enc(lng - pLng)
		pLat, pLng = lat, lng
	}
	return b.String()
}

func TestDecodePolyline6(t *testing.T) {
	pts := []contract.GeoPoint{{Latitude: 52.2297, Longitude: 21.0122}, {Latitude: -33.868, Longitude: 151.209}, {Latitude: 0, Longitude: -0.000001}}
	if got := decodePolyline6(encodePolyline6(pts)); len(got) != 3 || got[0] != pts[0] || got[1] != pts[1] || got[2] != pts[2] {
		t.Fatalf("decoded %v", got)
	}
	if got := decodePolyline6("_"); len(got) != 0 {
		t.Fatalf("truncated shape decoded to %v", got)
	}
}

func TestThin(t *testing.T) {
	path := make([]contract.GeoPoint, 101)
	for i := range path {
		path[i] = contract.GeoPoint{Longitude: float64(i)}
	}
	got := thin(path, 11)
	if len(got) != 11 || got[0].Longitude != 0 || got[5].Longitude != 50 || got[10].Longitude != 100 {
		t.Fatalf("thin = %v", got)
	}
}

func TestRouteOnRoads(t *testing.T) {
	a, b, c := contract.GeoPoint{Latitude: 52, Longitude: 21}, contract.GeoPoint{Latitude: 52, Longitude: 21.01}, contract.GeoPoint{Latitude: 52.01, Longitude: 21.01}
	var got struct {
		Locations []struct{ Lat, Lon float64 }
		Costing   string
	}
	valhalla := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/route" || !strings.HasPrefix(r.UserAgent(), "holtdroid") {
			http.NotFound(w, r)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		if got.Locations[0].Lat == 0 {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error_code":442,"error":"No path could be found for input"}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"trip": map[string]any{"legs": []map[string]string{
			{"shape": encodePolyline6([]contract.GeoPoint{a, b})},
			{"shape": encodePolyline6([]contract.GeoPoint{b, c})},
		}}})
	}))
	t.Cleanup(valhalla.Close)
	h := newHarnessWith(t, 1, func(c *Config) { c.Routing.URL = valhalla.URL })

	rec := h.do(http.MethodPost, "/api/v1/map/route", "alice", "", map[string]any{"points": []contract.GeoPoint{a, c}, "mode": "drive"})
	var route RoadRoute
	if err := json.Unmarshal(rec.Body.Bytes(), &route); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("route = %d %s", rec.Code, rec.Body)
	}
	want := contract.Distance(a, b) + contract.Distance(b, c)
	if len(route.Points) != 3 || route.Points[1] != b || math.Abs(route.Length-want) > 0.01 || got.Costing != "auto" || len(got.Locations) != 2 {
		t.Fatalf("route %+v, sent %+v", route, got)
	}

	rec = h.do(http.MethodPost, "/api/v1/map/route", "alice", "", map[string]any{"points": []contract.GeoPoint{{Latitude: 0, Longitude: 1}, c}, "mode": "walk"})
	if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "No path could be found") || got.Costing != "pedestrian" {
		t.Fatalf("no path = %d %s", rec.Code, rec.Body)
	}
	if rec := h.do(http.MethodPost, "/api/v1/map/route", "alice", "", map[string]any{"points": []contract.GeoPoint{a}, "mode": "walk"}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("one point = %d", rec.Code)
	}
	if rec := h.do(http.MethodGet, "/api/v1/map", "alice", "", nil); !strings.Contains(rec.Body.String(), `"routing":true`) {
		t.Fatalf("map view = %s", rec.Body)
	}

	off := newHarnessWith(t, 1, func(c *Config) { c.Routing.URL = "" })
	if rec := off.do(http.MethodPost, "/api/v1/map/route", "alice", "", map[string]any{"points": []contract.GeoPoint{a, c}, "mode": "walk"}); rec.Code != http.StatusNotFound {
		t.Fatalf("routing off = %d", rec.Code)
	}
}
