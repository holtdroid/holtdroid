package api

import (
	"bytes"
	"context"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

// MapConfig points the GPS map at a tile server that serves a MapLibre style,
// its TileJSON, tiles, sprites and glyphs under one base URL (decision #97).
type MapConfig struct {
	URL       string
	Style     string
	DarkStyle string
}

const mapTilesPath = "/api/v1/map/tiles/"

const maxMapResponse = 16 << 20

type MapView struct {
	Enabled   bool   `json:"enabled"`
	Routing   bool   `json:"routing" doc:"POST /api/v1/map/route can follow roads"`
	Style     string `json:"style,omitempty" doc:"MapLibre style URL, proxied through the portal"`
	DarkStyle string `json:"darkStyle,omitempty" doc:"the style for the dark theme"`
}

func (s *Server) registerMap(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "getMap", Method: http.MethodGet, Path: "/api/v1/map", Tags: []string{"ui"}},
		func(context.Context, *struct{}) (*out[MapView], error) {
			if s.cfg.Map.URL == "" {
				return &out[MapView]{MapView{Routing: s.cfg.Routing.URL != ""}}, nil
			}
			dark := s.cfg.Map.DarkStyle
			if dark == "" {
				dark = s.cfg.Map.Style
			}
			return &out[MapView]{MapView{
				Enabled:   true,
				Routing:   s.cfg.Routing.URL != "",
				Style:     mapTilesPath + strings.TrimLeft(s.cfg.Map.Style, "/"),
				DarkStyle: mapTilesPath + strings.TrimLeft(dark, "/"),
			}}, nil
		})
	s.registerRouting(api)
}

var mapClient = &http.Client{Timeout: 30 * time.Second}

func (s *Server) serveMapTile(w http.ResponseWriter, r *http.Request) {
	base := strings.TrimRight(s.cfg.Map.URL, "/")
	if base == "" {
		http.NotFound(w, r)
		return
	}
	target, err := url.JoinPath(base, r.PathValue("path"))
	if err != nil || !strings.HasPrefix(target, base+"/") {
		http.Error(w, "bad map path", http.StatusBadRequest)
		return
	}
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		http.Error(w, "bad map path", http.StatusBadRequest)
		return
	}
	req.Header.Set("User-Agent", "holtdroid (+https://github.com/holtdroid/holtdroid)")
	if v := r.Header.Get("If-None-Match"); v != "" {
		req.Header.Set("If-None-Match", v)
	}
	resp, err := mapClient.Do(req)
	if err != nil {
		http.Error(w, "map server unreachable", http.StatusBadGateway)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	for _, h := range []string{"Content-Type", "Cache-Control", "ETag", "Last-Modified", "Expires"} {
		if v := resp.Header.Values(h); len(v) > 0 {
			w.Header()[h] = v
		}
	}
	body := io.LimitReader(resp.Body, maxMapResponse)
	if mt, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type")); mt == "application/json" && resp.StatusCode == http.StatusOK {
		raw, err := io.ReadAll(body)
		if err != nil {
			http.Error(w, "map server failed", http.StatusBadGateway)
			return
		}
		raw = bytes.ReplaceAll(raw, []byte(base+"/"), []byte(mapTilesPath))
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(raw)
		return
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, body)
}
