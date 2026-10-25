package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/contract"
)

// RoutingConfig points GPS routes at a Valhalla server (decision #99).
type RoutingConfig struct {
	URL string
}

const maxRoutePoints = 5000

var costings = map[string]string{"walk": "pedestrian", "run": "pedestrian", "drive": "auto"}

type roadRouteInput struct {
	Body struct {
		Points []contract.GeoPoint `json:"points" minItems:"2" maxItems:"20" doc:"the start and the points to pass, in order"`
		Mode   string              `json:"mode" enum:"walk,run,drive"`
	}
}

type RoadRoute struct {
	Points []contract.GeoPoint `json:"points" doc:"the path along roads, at most 5000 points"`
	Length float64             `json:"length" doc:"metres"`
}

func (s *Server) registerRouting(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "routeOnRoads", Method: http.MethodPost, Path: "/api/v1/map/route", Tags: []string{"ui"}},
		func(ctx context.Context, in *roadRouteInput) (*out[RoadRoute], error) {
			if s.cfg.Routing.URL == "" {
				return nil, huma.Error404NotFound("routing is turned off")
			}
			r, err := s.routeOnRoads(ctx, in.Body.Points, costings[in.Body.Mode])
			if err != nil {
				return nil, err
			}
			return &out[RoadRoute]{r}, nil
		})
}

type valhallaLocation struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

func (s *Server) routeOnRoads(ctx context.Context, points []contract.GeoPoint, costing string) (RoadRoute, error) {
	req := struct {
		Locations      []valhallaLocation `json:"locations"`
		Costing        string             `json:"costing"`
		DirectionsType string             `json:"directions_type"`
	}{Costing: costing, DirectionsType: "none"}
	for _, p := range points {
		req.Locations = append(req.Locations, valhallaLocation{p.Latitude, p.Longitude})
	}
	body, err := json.Marshal(req)
	if err != nil {
		return RoadRoute{}, err
	}
	hr, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.cfg.Routing.URL, "/")+"/route", bytes.NewReader(body))
	if err != nil {
		return RoadRoute{}, err
	}
	hr.Header.Set("Content-Type", "application/json")
	hr.Header.Set("User-Agent", "holtdroid (+https://github.com/holtdroid/holtdroid)")
	resp, err := mapClient.Do(hr)
	if err != nil {
		return RoadRoute{}, huma.NewError(http.StatusBadGateway, "routing server unreachable")
	}
	defer func() { _ = resp.Body.Close() }()
	var res struct {
		Error string `json:"error"`
		Trip  struct {
			Legs []struct {
				Shape string `json:"shape"`
			} `json:"legs"`
		} `json:"trip"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxMapResponse)).Decode(&res); err != nil {
		return RoadRoute{}, huma.NewError(http.StatusBadGateway, "routing server failed")
	}
	switch {
	case resp.StatusCode >= 500:
		return RoadRoute{}, huma.NewError(http.StatusBadGateway, "routing server failed")
	case resp.StatusCode != http.StatusOK:
		return RoadRoute{}, huma.Error422UnprocessableEntity("no route: " + res.Error)
	}
	var path []contract.GeoPoint
	for _, leg := range res.Trip.Legs {
		pts := decodePolyline6(leg.Shape)
		if len(path) > 0 && len(pts) > 0 && path[len(path)-1] == pts[0] {
			pts = pts[1:]
		}
		path = append(path, pts...)
	}
	if len(path) < 2 {
		return RoadRoute{}, huma.Error422UnprocessableEntity("no route between these points")
	}
	path = thin(path, maxRoutePoints)
	return RoadRoute{Points: path, Length: contract.GeoRoute{Points: path}.Length()}, nil
}

func decodePolyline6(s string) []contract.GeoPoint {
	var pts []contract.GeoPoint
	var lat, lng int
	next := func(i *int) (int, bool) {
		var v, shift int
		for *i < len(s) {
			b := int(s[*i]) - 63
			*i++
			v |= (b & 0x1f) << shift
			shift += 5
			if b < 0x20 {
				if v&1 != 0 {
					return ^(v >> 1), true
				}
				return v >> 1, true
			}
		}
		return 0, false
	}
	for i := 0; i < len(s); {
		dLat, ok1 := next(&i)
		dLng, ok2 := next(&i)
		if !ok1 || !ok2 {
			break
		}
		lat += dLat
		lng += dLng
		pts = append(pts, contract.GeoPoint{Latitude: float64(lat) / 1e6, Longitude: float64(lng) / 1e6})
	}
	return pts
}

func thin(path []contract.GeoPoint, limit int) []contract.GeoPoint {
	if len(path) <= limit {
		return path
	}
	out := make([]contract.GeoPoint, 0, limit)
	step := float64(len(path)-1) / float64(limit-1)
	for i := range limit {
		out = append(out, path[int(float64(i)*step+0.5)])
	}
	return out
}
