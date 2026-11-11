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

func TestFakeNetworkStep(t *testing.T) {
	ctx := context.Background()
	start := time.Unix(1_760_000_000, 0)
	now := start
	d := &device{settings: defaultSettings(), subs: map[chan struct{}]struct{}{}, now: func() time.Time { return now }}

	s, _ := d.Device(ctx)
	if s.NetworkStep != nil || s.NetworkStepSince != nil {
		t.Fatalf("plain link: step %v since %v", s.NetworkStep, s.NetworkStepSince)
	}

	subway := contract.NetworkProfile("subway")
	if _, err := d.UpdateDevice(ctx, contract.DeviceSettings{NetworkProfile: &subway}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		at, since time.Duration
		step      int
	}{
		{0, 0, 0},
		{31 * time.Second, 30 * time.Second, 1},
		{50 * time.Second, 45 * time.Second, 2},
		{58 * time.Second, 57500 * time.Millisecond, 0},
	} {
		now = start.Add(tc.at)
		s, _ := d.Device(ctx)
		if s.NetworkStep == nil || s.NetworkStepSince == nil {
			t.Fatalf("at %v: no step", tc.at)
		}
		if *s.NetworkStep != tc.step || !s.NetworkStepSince.Equal(start.Add(tc.since)) {
			t.Errorf("at %v: step %d since +%v, want %d since +%v", tc.at, *s.NetworkStep, s.NetworkStepSince.Sub(start), tc.step, tc.since)
		}
	}

	restart := start.Add(31 * time.Second)
	now = restart
	if _, err := d.UpdateDevice(ctx, contract.DeviceSettings{NetworkRegion: &contract.NetworkRegionSettings{Region: "de"}}); err != nil {
		t.Fatal(err)
	}
	s, _ = d.Device(ctx)
	if s.NetworkStep == nil || *s.NetworkStep != 0 || !s.NetworkStepSince.Equal(restart) {
		t.Fatalf("after a region change: step %v since %v", s.NetworkStep, s.NetworkStepSince)
	}

	full := contract.NetworkFull
	if _, err := d.UpdateDevice(ctx, contract.DeviceSettings{NetworkProfile: &full}); err != nil {
		t.Fatal(err)
	}
	s, _ = d.Device(ctx)
	if s.NetworkStep != nil || s.NetworkStepSince != nil {
		t.Fatalf("back to a plain link: step %v since %v", s.NetworkStep, s.NetworkStepSince)
	}
}
