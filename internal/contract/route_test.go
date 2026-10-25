package contract

import (
	"math"
	"testing"
)

func TestDistance(t *testing.T) {
	if d := Distance(GeoPoint{}, GeoPoint{Longitude: 0.01}); math.Abs(d-1111.95) > 0.1 {
		t.Fatalf("distance = %v", d)
	}
	if l := (GeoRoute{Points: []GeoPoint{{}, {Longitude: 0.01}}, Loop: true}).Length(); math.Abs(l-2223.9) > 0.1 {
		t.Fatalf("loop length = %v", l)
	}
}

func sampleSpeeds(m *Motion, from, to float64) (lo, hi float64) {
	lo, hi = math.Inf(1), 0
	for t := from; t <= to; t += 0.5 {
		_, st := m.State(t)
		lo, hi = math.Min(lo, st.CurrentSpeed), math.Max(hi, st.CurrentSpeed)
	}
	return lo, hi
}

func TestMotionStraight(t *testing.T) {
	a, b := GeoPoint{}, GeoPoint{Longitude: 0.05}
	for _, tc := range []struct {
		name  string
		speed float64
	}{{"walk", 1.4}, {"drive", 13.9}} {
		t.Run(tc.name, func(t *testing.T) {
			m := GeoRoute{Points: []GeoPoint{a, b}, Speed: tc.speed}.Motion()
			length := m.length
			ideal := length / tc.speed
			if d := m.Duration(); d <= ideal || d > ideal*1.3 {
				t.Fatalf("duration %v for an ideal %v", d, ideal)
			}
			pt, st := m.State(0)
			if Distance(pt, a) > 0.01 || !st.Moving || st.CurrentSpeed > 0.5 {
				t.Fatalf("start: %+v %+v", pt, st)
			}
			if _, st := m.State(2); st.CurrentSpeed <= 0.5 || st.CurrentSpeed >= tc.speed {
				t.Fatalf("speeding up: %v after 2s", st.CurrentSpeed)
			}
			lo, hi := sampleSpeeds(m, m.Duration()*0.3, m.Duration()*0.7)
			if lo < tc.speed*0.8 || hi > tc.speed*1.2 || hi-lo < tc.speed*0.03 {
				t.Fatalf("cruising between %v and %v", lo, hi)
			}
			prev := -1.0
			for s := 0.0; s < m.Duration(); s += m.Duration() / 200 {
				_, st := m.State(s)
				if st.Travelled < prev {
					t.Fatalf("went back at %vs", s)
				}
				prev = st.Travelled
			}
			pt, st = m.State(m.Duration() + 1)
			if Distance(pt, b) > 0.01 || st.Moving || st.Travelled != length || st.CurrentSpeed != 0 {
				t.Fatalf("end: %+v %+v", pt, st)
			}
		})
	}
}

func TestMotionSlowsForTurns(t *testing.T) {
	corner := GeoPoint{Longitude: 0.02}
	m := GeoRoute{Points: []GeoPoint{{}, corner, {Latitude: 0.02, Longitude: 0.02}}, Speed: 13.9}.Motion()
	at := func(d float64) float64 {
		i := int(d / m.step)
		return m.speed[i]
	}
	half := m.length / 2
	if v := at(half); v > 13.9*0.5 {
		t.Fatalf("%v m/s at the corner", v)
	}
	if v := at(half / 2); v < 13.9*0.8 {
		t.Fatalf("%v m/s on the straight", v)
	}
	walk := GeoRoute{Points: m.route.Points, Speed: 1.4}.Motion()
	if v := walk.speed[int(half/walk.step)]; v < 1.4*0.7 || v > 1.4*0.95 {
		t.Fatalf("walking %v m/s at the corner", v)
	}
}

func TestMotionLoop(t *testing.T) {
	m := GeoRoute{Points: []GeoPoint{{}, {Longitude: 0.01}, {Latitude: 0.01, Longitude: 0.01}}, Speed: 2.8, Loop: true}.Motion()
	d := m.Duration()
	p1, s1 := m.State(d * 0.25)
	p2, s2 := m.State(d*3 + d*0.25)
	if Distance(p1, p2) > 0.01 || !s2.Moving || math.Abs(s1.CurrentSpeed-s2.CurrentSpeed) > 1e-9 {
		t.Fatalf("not periodic: %+v %+v", s1, s2)
	}
	_, a := m.State(d - 0.01)
	_, b := m.State(d + 0.01)
	if math.Abs(a.CurrentSpeed-b.CurrentSpeed) > 0.05 {
		t.Fatalf("speed jumps across the lap: %v → %v", a.CurrentSpeed, b.CurrentSpeed)
	}
	if _, st := m.State(0); st.CurrentSpeed < 1 {
		t.Fatalf("a loop starts at %v m/s", st.CurrentSpeed)
	}
}

func TestMotionStandingStill(t *testing.T) {
	pt, st := GeoRoute{Points: []GeoPoint{{Latitude: 1}, {Latitude: 1}}, Speed: 1}.Motion().State(5)
	if pt.Latitude != 1 || st.Moving || st.Duration != 0 {
		t.Fatalf("%+v %+v", pt, st)
	}
}
