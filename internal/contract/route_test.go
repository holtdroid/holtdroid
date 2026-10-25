package contract

import (
	"math"
	"testing"
)

func TestGeoRouteState(t *testing.T) {
	a, b, c := GeoPoint{Latitude: 0, Longitude: 0}, GeoPoint{Latitude: 0, Longitude: 0.01}, GeoPoint{Latitude: 0.01, Longitude: 0.01}
	leg := Distance(a, b)
	if math.Abs(leg-1111.95) > 0.1 {
		t.Fatalf("leg = %v", leg)
	}
	for _, tc := range []struct {
		name      string
		route     GeoRoute
		seconds   float64
		want      GeoPoint
		travelled float64
		moving    bool
	}{
		{"start", GeoRoute{Points: []GeoPoint{a, b}, Speed: 10}, 0, a, 0, true},
		{"halfway", GeoRoute{Points: []GeoPoint{a, b}, Speed: 10}, leg / 20, GeoPoint{Longitude: 0.005}, leg / 2, true},
		{"second leg", GeoRoute{Points: []GeoPoint{a, b, c}, Speed: 1}, leg * 1.5, GeoPoint{Latitude: 0.005, Longitude: 0.01}, leg * 1.5, true},
		{"stops at the end", GeoRoute{Points: []GeoPoint{a, b}, Speed: 10}, 1000, b, leg, false},
		{"loop comes back", GeoRoute{Points: []GeoPoint{a, b}, Speed: 1, Loop: true}, leg * 1.5, GeoPoint{Longitude: 0.005}, leg * 1.5, true},
		{"loop wraps", GeoRoute{Points: []GeoPoint{a, b}, Speed: 1, Loop: true}, leg * 2.5, GeoPoint{Longitude: 0.005}, leg / 2, true},
		{"one spot", GeoRoute{Points: []GeoPoint{a, a}, Speed: 1}, 5, a, 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, st := tc.route.State(tc.seconds)
			if Distance(got, tc.want) > 0.5 || math.Abs(st.Travelled-tc.travelled) > 0.5 || st.Moving != tc.moving {
				t.Errorf("got %+v travelled %v moving %v", got, st.Travelled, st.Moving)
			}
		})
	}
	if l := (GeoRoute{Points: []GeoPoint{a, b}, Loop: true}).Length(); math.Abs(l-2*leg) > 0.01 {
		t.Errorf("loop length = %v", l)
	}
}
