package api

import (
	"errors"
	"net/http"
	"net/http/httputil"
	"net/url"
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
	sess, err := p.Get(r.Context(), id)
	if errors.Is(err, contract.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	target, err := url.Parse(sess.AgentURL)
	if err != nil || sess.AgentURL == "" {
		http.Error(w, "session has no agent yet", http.StatusServiceUnavailable)
		return
	}

	if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
		s.activity.Mark(sessionKey{providerName, id})
	}

	prefix := "/s/" + providerName + "/" + id
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
			s.log.Warn("agent proxy error", "provider", providerName, "session", id, "err", err)
			http.Error(w, "device agent unavailable", http.StatusBadGateway)
		},
	}
	rp.ServeHTTP(w, r)
}

func singleJoin(a, b string) string {
	return strings.TrimRight(a, "/") + "/" + strings.TrimLeft(b, "/")
}
