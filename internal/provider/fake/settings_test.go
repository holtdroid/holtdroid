package fake

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func TestFakeRoute(t *testing.T) {
	ctx := context.Background()
	now := time.Unix(1_760_000_000, 0)
	d := &device{settings: defaultSettings(), subs: map[chan struct{}]struct{}{}, now: func() time.Time { return now }}
	route := contract.GeoRoute{Points: []contract.GeoPoint{{Latitude: 0, Longitude: 0}, {Latitude: 0, Longitude: 0.01}}, Speed: 10}
	if _, err := d.UpdateDevice(ctx, contract.DeviceSettings{Route: &route}); err != nil {
		t.Fatal(err)
	}
	half := route.Motion().Duration() / 2
	want, _ := route.Motion().State(half)
	now = now.Add(time.Duration(half * float64(time.Second)))
	s, _ := d.Device(ctx)
	if s.Route == nil || !s.Route.Moving || !s.GeoOverride || math.Abs(s.Geo.Longitude-want.Longitude) > 1e-6 {
		t.Fatalf("moving: geo %+v route %+v", s.Geo, s.Route)
	}
	if _, err := d.UpdateDevice(ctx, contract.DeviceSettings{StopRoute: true}); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Hour)
	s, _ = d.Device(ctx)
	if s.Route != nil || math.Abs(s.Geo.Longitude-want.Longitude) > 1e-6 {
		t.Fatalf("stopped: geo %+v route %+v", s.Geo, s.Route)
	}
}
