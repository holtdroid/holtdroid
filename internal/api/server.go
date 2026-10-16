package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/secrets"
	"github.com/kriakiku/holtdroid/internal/storage"
)

type Server struct {
	cfg        Config
	auth       *auth.Authenticator
	secrets    *secrets.Registry
	store      storage.Store
	sources    map[string]contract.Source
	srcOrder   []string
	providers  map[string]contract.Provider
	provOrder  []string
	cache      *Cache
	activity   *activity
	warm       chan [2]string
	ui         fs.FS
	lookupHost func(ctx context.Context, host string) ([]string, error)
	sshHTTP    *http.Client
	now        func() time.Time
	log        *slog.Logger
}

type Option func(*Server)

func WithClock(now func() time.Time) Option { return func(s *Server) { s.now = now } }

func WithUI(ui fs.FS) Option { return func(s *Server) { s.ui = ui } }

func WithSecrets(reg *secrets.Registry) Option { return func(s *Server) { s.secrets = reg } }

func WithStore(store storage.Store) Option { return func(s *Server) { s.store = store } }

func WithSource(name string, src contract.Source) Option {
	return func(s *Server) {
		s.sources[name] = src
		s.srcOrder = append(s.srcOrder, name)
	}
}

func WithProvider(name string, p contract.Provider) Option {
	return func(s *Server) {
		s.providers[name] = p
		s.provOrder = append(s.provOrder, name)
	}
}

func New(ctx context.Context, cfg Config, opts ...Option) (*Server, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	s := &Server{
		cfg:        cfg,
		sources:    map[string]contract.Source{},
		providers:  map[string]contract.Provider{},
		warm:       make(chan [2]string, 256),
		now:        time.Now,
		lookupHost: net.DefaultResolver.LookupHost,
		sshHTTP:    &http.Client{Timeout: 10 * time.Second},
		log:        slog.Default().With("component", "api"),
	}
	for _, e := range cfg.Sources {
		WithSource(e.Name, contract.NewSourceClient(e.URL, nil))(s)
	}
	for _, e := range cfg.Providers {
		WithProvider(e.Name, contract.NewProviderClient(e.URL, nil))(s)
	}
	for _, opt := range opts {
		opt(s)
	}
	if s.secrets == nil {
		s.secrets = secrets.NewRegistry()
	}
	var err error
	if s.auth, err = auth.New(ctx, cfg.Auth, s.secrets, cfg.PublicURL); err != nil {
		return nil, err
	}
	if s.store == nil {
		if s.store, err = storage.New(ctx, cfg.Storage, s.secrets); err != nil {
			return nil, err
		}
	}
	s.activity = newActivity(s.now)
	s.cache = NewCache(s.store, int64(cfg.Cache.MaxSize), s.openArtifact)
	return s, nil
}

func (s *Server) openArtifact(ctx context.Context, source, id string) (contract.Artifact, io.ReadCloser, error) {
	src, ok := s.sources[source]
	if !ok {
		return contract.Artifact{}, nil, fmt.Errorf("%w: source %q", contract.ErrNotFound, source)
	}
	a, err := src.Get(ctx, id)
	if err != nil {
		return contract.Artifact{}, nil, err
	}
	rc, _, err := src.Open(ctx, id)
	if err != nil {
		return contract.Artifact{}, nil, err
	}
	return a, rc, nil
}

func NewHumaAPI(mux *http.ServeMux, title, version string) huma.API {
	cfg := huma.DefaultConfig(title, version)
	cfg.OpenAPIPath = "/api/openapi"
	cfg.DocsPath = "/api/docs"
	cfg.SchemasPath = "/api/schemas"
	cfg.CreateHooks = nil
	return humago.New(mux, cfg)
}

// Handler serves the browser-facing UI, REST API and session proxy.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	api := NewHumaAPI(mux, "Holtdroid", "v1")
	s.register(api)
	mux.Handle("/s/{provider}/{id}/", http.HandlerFunc(s.proxy))
	mux.Handle("/api/v1/auth/oidc/", s.auth.OIDCHandler())
	mux.Handle("/", s.uiHandler())

	protected := s.auth.Middleware(mux)
	optional := s.auth.Optional(mux)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch {
		case p == "/healthz":
			w.WriteHeader(http.StatusOK)
		case strings.HasPrefix(p, "/api/v1/auth"), strings.HasPrefix(p, "/api/openapi"),
			strings.HasPrefix(p, "/api/docs"), strings.HasPrefix(p, "/api/schemas"):
			optional.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/api/"), strings.HasPrefix(p, "/s/"):
			protected.ServeHTTP(w, r)
		default:
			mux.ServeHTTP(w, r)
		}
	})
}

// InternalHandler serves endpoints only agents call; it must never be
// exposed through the ingress.
func (s *Server) InternalHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /internal/artifacts/{source}/{id}", func(w http.ResponseWriter, r *http.Request) {
		rc, size, err := s.cache.OpenAPK(r.Context(), r.PathValue("source"), r.PathValue("id"))
		if errors.Is(err, storage.ErrNotExist) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rc.Close()
		w.Header().Set("Content-Type", "application/vnd.android.package-archive")
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
		_, _ = io.Copy(w, rc)
	})
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	return mux
}

func (s *Server) artifactURL(source, id string) string {
	return strings.TrimRight(s.cfg.InternalURL, "/") + "/internal/artifacts/" + source + "/" + id
}

// OpenAPI returns the UI API description, used to generate the web client.
func OpenAPI() *huma.OpenAPI {
	a, _ := auth.New(context.Background(), auth.Config{Mode: auth.ModeNone}, nil, "")
	s := &Server{auth: a, sources: map[string]contract.Source{}, providers: map[string]contract.Provider{}}
	api := NewHumaAPI(http.NewServeMux(), "Holtdroid", "v1")
	s.register(api)
	return api.OpenAPI()
}

func (s *Server) uiHandler() http.Handler {
	if s.ui == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "web UI not built into this binary", http.StatusNotFound)
		})
	}
	files := http.FileServerFS(s.ui)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name != "" {
			if f, err := s.ui.Open(name); err == nil {
				_ = f.Close()
				if strings.HasPrefix(name, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFileFS(w, r, s.ui, "index.html")
	})
}
