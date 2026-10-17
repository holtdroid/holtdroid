package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httputil"
	"path"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kriakiku/holtdroid/internal/audit"
	"github.com/kriakiku/holtdroid/internal/contract"
)

// proxy forwards /s/{provider}/{id}/... to the session's agent. Everything a
// browser does with a device goes through here, so it stays same-origin and
// behind the portal's auth.
func (s *Server) proxy(w http.ResponseWriter, r *http.Request) {
	providerName, id := r.PathValue("provider"), r.PathValue("id")
	p, err := s.provider(providerName)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	key := sessionKey{providerName, id}
	target, err := s.agents.get(r.Context(), key, p)
	switch {
	case errors.Is(err, contract.ErrNotFound):
		http.NotFound(w, r)
		return
	case errors.Is(err, errNoAgent):
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	case err != nil:
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	prefix := "/s/" + providerName + "/" + id
	rel := path.Clean(strings.TrimPrefix(r.URL.Path, prefix))
	if rel == "/v1/install" {
		http.Error(w, "install builds through /api/v1/sessions/{provider}/{id}/install", http.StatusForbidden)
		return
	}
	if rel == "/v1/app-data" || strings.HasPrefix(rel, "/v1/app-data/") {
		http.Error(w, "app data is saved through /api/v1/sessions/{provider}/{id}/app-data", http.StatusForbidden)
		return
	}

	if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
		s.activity.Mark(key)
	}
	proxyConnections.WithLabelValues(providerName).Inc()
	defer proxyConnections.WithLabelValues(providerName).Dec()
	ev := s.proxyAudit(r, rel)
	if ev != nil {
		ev.Provider, ev.Session = providerName, id
	}

	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.URL.Path = singleJoin(target.Path, strings.TrimPrefix(pr.In.URL.Path, prefix))
			pr.Out.URL.RawPath = ""
			pr.Out.Header.Set("X-Forwarded-Prefix", prefix)
			pr.SetXForwarded()
		},
		FlushInterval: -1,
		Transport:     s.agentTransport,
		ModifyResponse: func(resp *http.Response) error {
			if ev != nil {
				s.emitResult(r.Context(), *ev, statusError(resp))
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			if ev != nil {
				s.emitResult(r.Context(), *ev, err)
			}
			s.agents.forget(key)
			s.log.Warn("agent proxy error", "provider", providerName, "session", id, "err", err)
			http.Error(w, "device agent unavailable", http.StatusBadGateway)
		},
	}
	rp.ServeHTTP(w, r)
}

// proxyAudit returns the audit event for agent calls worth recording, or nil.
// The clipboard's content is never recorded.
func (s *Server) proxyAudit(r *http.Request, rel string) *audit.Event {
	switch {
	case r.Method == http.MethodPut && rel == "/v1/network/location":
		head, _ := io.ReadAll(io.LimitReader(r.Body, 4<<10))
		r.Body = readCloser{io.MultiReader(bytes.NewReader(head), r.Body), r.Body}
		var in contract.SetLocation
		_ = json.Unmarshal(head, &in)
		return &audit.Event{Action: audit.SessionLocation, Details: map[string]string{"location": in.Location}}
	case r.Method == http.MethodPost && rel == "/v1/clipboard":
		return &audit.Event{Action: audit.SessionClipboard}
	}
	return nil
}

type readCloser struct {
	io.Reader
	io.Closer
}

func statusError(resp *http.Response) error {
	switch {
	case resp.StatusCode < 300:
		return nil
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
		return huma.NewError(resp.StatusCode, resp.Status)
	}
	return errors.New(resp.Status)
}

func singleJoin(a, b string) string {
	return strings.TrimRight(a, "/") + "/" + strings.TrimLeft(b, "/")
}
