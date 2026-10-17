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

	"github.com/kriakiku/holtdroid/internal/audit"
	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/db"
	"github.com/kriakiku/holtdroid/internal/rules"
	"github.com/kriakiku/holtdroid/internal/secrets"
	"github.com/kriakiku/holtdroid/internal/source"
	"github.com/kriakiku/holtdroid/internal/storage"
	"github.com/kriakiku/holtdroid/internal/telemetry"
)

type Server struct {
	cfg            Config
	auth           *auth.Authenticator
	secrets        *secrets.Registry
	store          storage.Store
	db             *db.DB
	sources        map[string]*source.Source
	srcOrder       []string
	providers      map[string]contract.Provider
	agents         *agentURLs
	provOrder      []string
	cache          *Cache
	appData        *appDataStore
	activity       *activity
	warm           chan warmItem
	library        *library
	ui             fs.FS
	lookupHost     func(ctx context.Context, host string) ([]string, error)
	sshHTTP        *http.Client
	audit          *audit.Logger
	launches       *launches
	agentTransport http.RoundTripper
	now            func() time.Time
	log            *slog.Logger
}

type Option func(*Server)

func WithClock(now func() time.Time) Option { return func(s *Server) { s.now = now } }

func WithUI(ui fs.FS) Option { return func(s *Server) { s.ui = ui } }

func WithSecrets(reg *secrets.Registry) Option { return func(s *Server) { s.secrets = reg } }

func WithStore(store storage.Store) Option { return func(s *Server) { s.store = store } }

func WithAudit(l *audit.Logger) Option { return func(s *Server) { s.audit = l } }

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
		cfg:            cfg,
		sources:        map[string]*source.Source{},
		providers:      map[string]contract.Provider{},
		warm:           make(chan warmItem, 256),
		library:        newLibrary(),
		now:            time.Now,
		lookupHost:     net.DefaultResolver.LookupHost,
		sshHTTP:        &http.Client{Timeout: 10 * time.Second, Transport: telemetry.Transport(nil)},
		launches:       newLaunches(),
		agentTransport: telemetry.Transport(nil),
		log:            slog.Default().With("component", "api"),
	}
	s.agents = newAgentURLs(5*time.Second, func() time.Time { return s.now() })
	for _, e := range cfg.Providers {
		WithProvider(e.Name, contract.NewProviderClient(e.URL, nil))(s)
	}
	for _, opt := range opts {
		opt(s)
	}
	if s.secrets == nil {
		s.secrets = secrets.NewRegistry()
	}
	for _, sc := range cfg.Sources {
		store, err := storage.New(ctx, sc.Storage(), s.secrets)
		if err != nil {
			return nil, fmt.Errorf("source %q: %w", sc.Name, err)
		}
		include, err := rules.Parse(sc.Include)
		if err != nil {
			return nil, fmt.Errorf("source %q: include: %w", sc.Name, err)
		}
		s.sources[sc.Name] = source.New(store, sc.ReadOnly, include)
		s.srcOrder = append(s.srcOrder, sc.Name)
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
	if s.db, err = db.Open(ctx, cfg.Database); err != nil {
		return nil, err
	}
	if cfg.AppData.Enabled {
		s.appData = &appDataStore{store: s.store, prefix: appDataPrefix}
		if cfg.AppData.Storage.Type != "" {
			store, err := storage.New(ctx, cfg.AppData.Storage, s.secrets)
			if err != nil {
				return nil, fmt.Errorf("appData.storage: %w", err)
			}
			s.appData = &appDataStore{store: store}
		}
	}
	s.auth.OnSignIn = s.signedIn
	s.activity = newActivity(s.now)
	s.cache = NewCache(s.store, int64(cfg.Cache.MaxSize), s.openArtifact, s.openIcon)
	return s, nil
}

func (s *Server) Close() error { return s.db.Close() }

// emit sends an audit event, filling the actor from the request, and keeps
// session events in the database.
func (s *Server) emit(ctx context.Context, ev audit.Event) {
	if who, ok := auth.FromContext(ctx); ok && ev.Actor == "" {
		ev.Actor, ev.Admin = who.User, who.Admin
	}
	if ev.Time.IsZero() {
		ev.Time = s.now()
	}
	if ev.Result == "" {
		ev.Result = audit.OK
	}
	s.audit.Emit(ctx, ev)
	if ev.Session == "" {
		return
	}
	err := s.db.AddSessionEvent(ctx, db.AddSessionEventParams{
		At: ev.Time, Provider: ev.Provider, SessionID: ev.Session, Action: string(ev.Action), Result: string(ev.Result),
		Actor: ev.Actor, Artifact: ev.Artifact, Reason: ev.Reason,
	})
	if err != nil {
		s.log.Warn("could not record session event", "provider", ev.Provider, "session", ev.Session, "action", ev.Action, "err", err)
	}
}

// outcome maps an error to an audit result and reason.
func outcome(err error) (audit.Result, string) {
	switch {
	case err == nil:
		return audit.OK, ""
	case errors.Is(err, errForbidden), errors.Is(err, auth.ErrForbidden), errors.Is(err, auth.ErrBadPassword):
		return audit.Denied, err.Error()
	}
	var he huma.StatusError
	if errors.As(err, &he) && (he.GetStatus() == http.StatusForbidden || he.GetStatus() == http.StatusUnauthorized) {
		return audit.Denied, err.Error()
	}
	return audit.Failed, err.Error()
}

func (s *Server) emitResult(ctx context.Context, ev audit.Event, err error) {
	ev.Result, ev.Reason = outcome(err)
	s.emit(ctx, ev)
}

// requested names the artifact a request refers to by its source and
// encoded id, for audit events of requests that failed before resolving it.
func requested(source, encoded string) string {
	if key, err := decodeID(encoded); err == nil {
		return source + "/" + key
	}
	return source + "/" + encoded
}

func (s *Server) signedIn(ctx context.Context, method string, id auth.Identity, err error) {
	s.emitResult(ctx, audit.Event{Action: audit.SignIn, Actor: id.User, Admin: id.Admin, Details: map[string]string{"method": method}}, err)
}

func (s *Server) source(name string) (*source.Source, error) {
	src, ok := s.sources[name]
	if !ok {
		return nil, fmt.Errorf("%w: source %q", contract.ErrNotFound, name)
	}
	return src, nil
}

func (s *Server) openArtifact(ctx context.Context, name, id string) (io.ReadCloser, error) {
	src, err := s.source(name)
	if err != nil {
		return nil, err
	}
	rc, _, err := src.Open(ctx, id)
	return rc, err
}

func (s *Server) openIcon(ctx context.Context, name, id string) (io.ReadCloser, error) {
	src, err := s.source(name)
	if err != nil {
		return nil, err
	}
	return src.OpenIcon(ctx, id)
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
	telemetry.Instrument(api, "ui")
	s.register(api)
	mux.Handle("/s/{provider}/{id}/", http.HandlerFunc(s.proxy))
	mux.Handle("/api/v1/auth/oidc/", s.auth.OIDCHandler())
	mux.Handle("/", s.uiHandler())

	protected := s.auth.Middleware(mux)
	optional := s.auth.Optional(mux)
	return audit.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch {
		case p == "/healthz":
			w.WriteHeader(http.StatusOK)
		case strings.HasPrefix(p, "/api/v1/auth"), strings.HasPrefix(p, "/api/openapi"),
			strings.HasPrefix(p, "/api/docs"), strings.HasPrefix(p, "/api/schemas"):
			optional.ServeHTTP(w, r)
		case p == uploadPath && r.Method == http.MethodPost:
			r.Body = http.MaxBytesReader(w, r.Body, int64(s.cfg.Uploads.MaxSize)+1<<20)
			protected.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/api/"), strings.HasPrefix(p, "/s/"):
			protected.ServeHTTP(w, r)
		default:
			mux.ServeHTTP(w, r)
		}
	}))
}

// InternalHandler serves endpoints only agents and the ssh-gateway call; it must never be
// exposed through the ingress.
func (s *Server) InternalHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /internal/artifacts/{key}", func(w http.ResponseWriter, r *http.Request) {
		rc, size, err := s.cache.OpenAPK(r.Context(), r.PathValue("key"))
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
	mux.HandleFunc("GET /internal/app-data/{key...}", s.serveInternalAppData)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	contract.RegisterSSHSessions(contract.NewAPI(mux, "Holtdroid api internal"), s)
	return mux
}

func (s *Server) artifactURL(key string) string {
	return strings.TrimRight(s.cfg.InternalURL, "/") + "/internal/artifacts/" + key
}

// OpenAPI returns the UI API description, used to generate the web client.
func OpenAPI() *huma.OpenAPI {
	a, _ := auth.New(context.Background(), auth.Config{Mode: auth.ModeNone}, nil, "")
	s := &Server{auth: a, sources: map[string]*source.Source{}, providers: map[string]contract.Provider{}}
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
