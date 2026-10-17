package api

import (
	"errors"
	"net/http"
	"net/http/httputil"
	"path"
	"strings"

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
	if path.Clean(strings.TrimPrefix(r.URL.Path, prefix)) == "/v1/install" {
		http.Error(w, "install builds through /api/v1/sessions/{provider}/{id}/install", http.StatusForbidden)
		return
	}

	if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
		s.activity.Mark(key)
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
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			s.agents.forget(key)
			s.log.Warn("agent proxy error", "provider", providerName, "session", id, "err", err)
			http.Error(w, "device agent unavailable", http.StatusBadGateway)
		},
	}
	rp.ServeHTTP(w, r)
}

func singleJoin(a, b string) string {
	return strings.TrimRight(a, "/") + "/" + strings.TrimLeft(b, "/")
}
