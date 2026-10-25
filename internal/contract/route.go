package contract

import (
	"math"
	"slices"
	"sort"
)

// GeoRoute moves the faked GPS along points around a cruising speed
// (decisions #98, #100).
type GeoRoute struct {
	Points []GeoPoint `json:"points" minItems:"2" maxItems:"5000"`
	Speed  float64    `json:"speed" minimum:"0.1" maximum:"350" doc:"cruising speed in metres per second; the device speeds up, slows down for turns and drifts around it"`
	Loop   bool       `json:"loop,omitempty" doc:"after the last point head back to the first and go round again"`
}

type GeoRouteState struct {
	GeoRoute
	Travelled    float64 `json:"travelled" doc:"metres covered in the current pass"`
	Length       float64 `json:"length" doc:"metres of one pass, back to the first point included with loop"`
	Duration     float64 `json:"duration" doc:"seconds one pass takes"`
	CurrentSpeed float64 `json:"currentSpeed" doc:"metres per second right now"`
	Moving       bool    `json:"moving" doc:"false once a route without loop has reached its last point"`
}

const earthRadius = 6371008.8

// Distance is the great-circle distance between two points in metres.
func Distance(a, b GeoPoint) float64 {
	rad := math.Pi / 180
	dLat := (b.Latitude - a.Latitude) * rad
	dLng := (b.Longitude - a.Longitude) * rad
	h := math.Pow(math.Sin(dLat/2), 2) + math.Cos(a.Latitude*rad)*math.Cos(b.Latitude*rad)*math.Pow(math.Sin(dLng/2), 2)
	return 2 * earthRadius * math.Asin(math.Min(1, math.Sqrt(h)))
}

func (r GeoRoute) path() []GeoPoint {
	if r.Loop && len(r.Points) > 1 {
		return append(slices.Clip(r.Points), r.Points[0])
	}
	return r.Points
}

func (r GeoRoute) Length() float64 {
	var l float64
	p := r.path()
	for i := 1; i < len(p); i++ {
		l += Distance(p[i-1], p[i])
	}
	return l
}

const (
	maxMotionSamples = 20000
	crawlSpeed       = 0.3
)

// Motion is a route's speed profile: the speed is sampled along the path,
// limited by turns and by how fast the device can speed up and slow down, and
// integrated into the time each sample is reached.
type Motion struct {
	route  GeoRoute
	path   []GeoPoint
	cum    []float64
	length float64
	step   float64
	speed  []float64
	time   []float64
}

func (r GeoRoute) Motion() *Motion {
	m := &Motion{route: r, path: r.path()}
	m.cum = make([]float64, len(m.path))
	for i := 1; i < len(m.path); i++ {
		m.cum[i] = m.cum[i-1] + Distance(m.path[i-1], m.path[i])
	}
	if len(m.cum) > 0 {
		m.length = m.cum[len(m.cum)-1]
	}
	if m.length == 0 || r.Speed <= 0 {
		return m
	}
	n := min(maxMotionSamples, max(2, int(math.Ceil(m.length/2))))
	m.step = m.length / float64(n)
	base := r.Speed
	m.speed = make([]float64, n+1)
	for i := range m.speed {
		m.speed[i] = m.target(float64(i) * m.step)
	}
	if !r.Loop {
		m.speed[0], m.speed[n] = crawlSpeed, crawlSpeed
	}
	accel := math.Max(0.3, math.Min(2, 0.25+0.1*base))
	limit := func(i, j int) {
		m.speed[j] = math.Min(m.speed[j], math.Sqrt(m.speed[i]*m.speed[i]+2*accel*m.step))
	}
	passes := 1
	if r.Loop {
		passes = 2
	}
	for range passes {
		for i := 1; i <= n; i++ {
			limit(i-1, i)
		}
		if r.Loop {
			limit(n, 0)
		}
		for i := n - 1; i >= 0; i-- {
			limit(i+1, i)
		}
		if r.Loop {
			limit(0, n)
		}
	}
	m.time = make([]float64, n+1)
	for i := 1; i <= n; i++ {
		m.time[i] = m.time[i-1] + 2*m.step/(m.speed[i-1]+m.speed[i])
	}
	return m
}

func (m *Motion) target(s float64) float64 {
	base := m.route.Speed
	wave := func(seconds, phase float64) float64 {
		l := seconds * base
		if m.route.Loop {
			l = m.length / math.Max(1, math.Round(m.length/l))
		}
		return math.Sin(2*math.Pi*s/l + phase)
	}
	drift := (0.06 + 0.004*math.Min(base, 15)) * (0.6*wave(20, 0.7) + 0.4*wave(47, 2.1))
	severity := math.Max(0.2, math.Min(1, base/14))
	turn := m.turn(s, math.Max(5, 2.5*base))
	v := base * (1 + drift) * (1 - 0.75*severity*math.Min(1, turn/(math.Pi/2)))
	return math.Max(crawlSpeed, v)
}

// turn is how much the heading changes, in radians, between w metres before
// s and w metres after it.
func (m *Motion) turn(s, w float64) float64 {
	a, b, c := m.at(m.wrap(s-w)), m.at(s), m.at(m.wrap(s+w))
	cosLat := math.Cos(b.Latitude * math.Pi / 180)
	vec := func(p, q GeoPoint) (float64, float64) {
		return (q.Longitude - p.Longitude) * cosLat, q.Latitude - p.Latitude
	}
	x1, y1 := vec(a, b)
	x2, y2 := vec(b, c)
	n1, n2 := math.Hypot(x1, y1), math.Hypot(x2, y2)
	if n1 == 0 || n2 == 0 {
		return 0
	}
	return math.Acos(math.Max(-1, math.Min(1, (x1*x2+y1*y2)/(n1*n2))))
}

func (m *Motion) wrap(s float64) float64 {
	if m.route.Loop {
		return math.Mod(math.Mod(s, m.length)+m.length, m.length)
	}
	return math.Max(0, math.Min(m.length, s))
}

func (m *Motion) at(d float64) GeoPoint {
	if len(m.path) == 0 {
		return GeoPoint{}
	}
	i := sort.SearchFloat64s(m.cum, d)
	switch {
	case i == 0:
		return m.path[0]
	case i >= len(m.path):
		return m.path[len(m.path)-1]
	}
	seg := m.cum[i] - m.cum[i-1]
	if seg == 0 {
		return m.path[i]
	}
	f := (d - m.cum[i-1]) / seg
	p, q := m.path[i-1], m.path[i]
	return GeoPoint{Latitude: p.Latitude + (q.Latitude-p.Latitude)*f, Longitude: p.Longitude + (q.Longitude-p.Longitude)*f}
}

func (m *Motion) Duration() float64 {
	if len(m.time) == 0 {
		return 0
	}
	return m.time[len(m.time)-1]
}

// State is where the route is after moving for seconds.
func (m *Motion) State(seconds float64) (GeoPoint, GeoRouteState) {
	st := GeoRouteState{GeoRoute: m.route, Length: m.length, Duration: m.Duration()}
	total := st.Duration
	if total == 0 {
		return m.at(0), st
	}
	t := max(seconds, 0)
	switch {
	case m.route.Loop:
		t = math.Mod(t, total)
	case t >= total:
		st.Travelled = m.length
		return m.at(m.length), st
	}
	st.Moving = true
	i := max(0, sort.SearchFloat64s(m.time, t)-1)
	i = min(i, len(m.time)-2)
	f := (t - m.time[i]) / (m.time[i+1] - m.time[i])
	st.Travelled = (float64(i) + f) * m.step
	st.CurrentSpeed = m.speed[i] + (m.speed[i+1]-m.speed[i])*f
	return m.at(st.Travelled), st
}
