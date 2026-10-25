package contract

import (
	"math"
	"slices"
)

// GeoRoute moves the faked GPS along points at a constant speed (decision #98).
type GeoRoute struct {
	Points []GeoPoint `json:"points" minItems:"2" maxItems:"5000"`
	Speed  float64    `json:"speed" minimum:"0.1" maximum:"350" doc:"metres per second"`
	Loop   bool       `json:"loop,omitempty" doc:"after the last point head back to the first and go round again"`
}

type GeoRouteState struct {
	GeoRoute
	Travelled float64 `json:"travelled" doc:"metres covered in the current pass"`
	Length    float64 `json:"length" doc:"metres of one pass, back to the first point included with loop"`
	Moving    bool    `json:"moving" doc:"false once a route without loop has reached its last point"`
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

// State is where the route is after moving for seconds.
func (r GeoRoute) State(seconds float64) (GeoPoint, GeoRouteState) {
	length := r.Length()
	d := max(seconds, 0) * r.Speed
	st := GeoRouteState{GeoRoute: r, Length: length, Moving: true}
	switch {
	case length == 0:
		d, st.Moving = 0, false
	case r.Loop:
		d = math.Mod(d, length)
	case d >= length:
		d, st.Moving = length, false
	}
	st.Travelled = d
	return r.at(d), st
}

func (r GeoRoute) at(d float64) GeoPoint {
	p := r.path()
	if len(p) == 0 {
		return GeoPoint{}
	}
	for i := 1; i < len(p); i++ {
		seg := Distance(p[i-1], p[i])
		if d <= seg && seg > 0 {
			f := d / seg
			return GeoPoint{
				Latitude:  p[i-1].Latitude + (p[i].Latitude-p[i-1].Latitude)*f,
				Longitude: p[i-1].Longitude + (p[i].Longitude-p[i-1].Longitude)*f,
			}
		}
		d -= seg
	}
	return p[len(p)-1]
}
