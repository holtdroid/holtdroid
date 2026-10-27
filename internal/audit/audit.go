// Package audit records who did what, when: a versioned event schema
// written as JSON lines to stdout and optionally to OTLP logs, a webhook and
// a bounded store of recent events for the admin page.
package audit

import (
	"cmp"
	"context"
	"errors"
	"io"
	"log/slog"
	"maps"
	"net"
	"net/http"
	"os"
	"slices"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/holtdroid/holtdroid/internal/secrets"
)

const Schema = 1

type Action string

const (
	SignIn           Action = "auth.signin"
	SignOut          Action = "auth.signout"
	SessionLaunch    Action = "session.launch"
	SessionStop      Action = "session.stop"
	SessionReap      Action = "session.reap"
	SessionExtend    Action = "session.extend"
	SessionInstall   Action = "session.install"
	SessionLocation  Action = "session.location"
	SessionClipboard Action = "session.clipboard"
	ArtifactUpload   Action = "artifact.upload"
	ArtifactUpdate   Action = "artifact.update"
	ArtifactDelete   Action = "artifact.delete"
	ArtifactDownload Action = "artifact.download"
	SSHEnroll        Action = "ssh.enroll"
	SSHConnect       Action = "ssh.connect"
	SSHDisconnect    Action = "ssh.disconnect"
	SSHTunnel        Action = "ssh.tunnel"
	ADBConnect       Action = "adb.connect"
	ADBDisconnect    Action = "adb.disconnect"
	AuditExport      Action = "audit.export"
	AppDataSave      Action = "appdata.save"
	AppDataDownload  Action = "appdata.download"
	AppDataDelete    Action = "appdata.delete"
	RecordingStart   Action = "recording.start"
	RecordingStop    Action = "recording.stop"
	RecordingDelete  Action = "recording.delete"
	RecordingMarker  Action = "recording.marker"
	RecordingRename  Action = "recording.rename"
	RecordingShare   Action = "recording.share"
	RecordingUnshare Action = "recording.unshare"
	ReferenceUpload  Action = "reference.upload"
	ReferenceDelete  Action = "reference.delete"
	Maintenance      Action = "provider.maintenance"
	UserSignUp       Action = "user.signup"
	UserCreate       Action = "user.create"
	UserUpdate       Action = "user.update"
	UserDelete       Action = "user.delete"
	UserRecovery     Action = "user.recovery"
	InviteCreate     Action = "invite.create"
	InviteDelete     Action = "invite.delete"
	PasskeyAdd       Action = "passkey.add"
	PasskeyDelete    Action = "passkey.delete"
	AppUpdate        Action = "app.update"
	FrontendDelete   Action = "devtools.frontend.delete"
)

var Actions = []Action{
	SignIn, SignOut, SessionLaunch, SessionStop, SessionReap, SessionExtend, SessionInstall, SessionLocation,
	SessionClipboard, ArtifactUpload, ArtifactUpdate, ArtifactDelete, ArtifactDownload, SSHEnroll, SSHConnect, SSHDisconnect, SSHTunnel,
	ADBConnect, ADBDisconnect, AuditExport, Maintenance, UserSignUp, UserCreate, UserUpdate, UserDelete, UserRecovery, InviteCreate, InviteDelete,
	PasskeyAdd, PasskeyDelete, AppUpdate,
}

type Result string

const (
	OK     Result = "ok"
	Denied Result = "denied"
	Failed Result = "failed"
)

type Event struct {
	Time         time.Time         `json:"time"`
	Schema       int               `json:"schema"`
	Service      string            `json:"service"`
	Action       Action            `json:"action"`
	Result       Result            `json:"result" enum:"ok,denied,failed"`
	Actor        string            `json:"actor,omitempty"`
	Admin        bool              `json:"admin,omitempty"`
	Provider     string            `json:"provider,omitempty"`
	Session      string            `json:"session,omitempty"`
	Artifact     string            `json:"artifact,omitempty"`
	ClientIP     string            `json:"clientIp,omitempty"`
	ForwardedFor string            `json:"forwardedFor,omitempty"`
	UserAgent    string            `json:"userAgent,omitempty"`
	Reason       string            `json:"reason,omitempty"`
	Details      map[string]string `json:"details,omitempty"`
}

type Sink interface {
	Write(ctx context.Context, ev Event)
	Close(ctx context.Context) error
}

type Config struct {
	Stdout  bool
	OTLP    OTLPConfig
	Webhook WebhookConfig
	Store   StoreConfig
	Forward bool
}

type OTLPConfig struct {
	Enabled  bool
	Endpoint string
	Insecure bool
}

type WebhookConfig struct {
	URL           secrets.Ref
	Authorization secrets.Ref
	BatchSize     int
	FlushInterval time.Duration
	Retries       int
	Timeout       time.Duration
}

func DefaultConfig() Config {
	return Config{
		Stdout:  true,
		Webhook: WebhookConfig{BatchSize: 100, FlushInterval: 5 * time.Second, Retries: 5, Timeout: 10 * time.Second},
		Store:   StoreConfig{Enabled: true, MaxEvents: 10000, MaxAge: 30 * 24 * time.Hour},
	}
}

func (c Config) Validate() error {
	if (!c.Webhook.URL.IsZero() || c.Forward) && (c.Webhook.BatchSize < 1 || c.Webhook.FlushInterval <= 0 || c.Webhook.Retries < 0 || c.Webhook.Timeout <= 0) {
		return errors.New("audit.webhook: batchSize, flushInterval and timeout must be positive, retries not negative")
	}
	if c.Store.Enabled && (c.Store.MaxEvents < 1 || c.Store.MaxAge < 0) {
		return errors.New("audit.store: maxEvents must be positive, maxAge not negative")
	}
	return nil
}

var (
	emitted = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "holtdroid_audit_events_total",
		Help: "Audit events by action and result.",
	}, []string{"action", "result"})
	dropped = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "holtdroid_audit_dropped_total",
		Help: "Audit events a sink could not deliver.",
	}, []string{"sink"})
)

// Logger fans events out to sinks. A nil Logger discards everything.
type Logger struct {
	service string
	sinks   []Sink
	store   *Store
	now     func() time.Time
}

type Option func(*Logger)

func WithClock(now func() time.Time) Option { return func(l *Logger) { l.now = now } }

func WithSink(s Sink) Option { return func(l *Logger) { l.sinks = append(l.sinks, s) } }

func WithStdout(w io.Writer) Option {
	return func(l *Logger) { l.sinks = append(l.sinks, newSlogSink(w)) }
}

// WithForward sends events in batches to another service's store, with the
// webhook's batching and retry settings.
func WithForward(ctx context.Context, cfg WebhookConfig, send func(context.Context, []Event) error) Option {
	return func(l *Logger) { l.sinks = append(l.sinks, newBatchSink(ctx, "forward", cfg, send)) }
}

func New(ctx context.Context, cfg Config, service, version string, reg *secrets.Registry, opts ...Option) (*Logger, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	l := &Logger{service: service, now: time.Now}
	if cfg.Stdout {
		l.sinks = append(l.sinks, newSlogSink(os.Stdout))
	}
	if cfg.OTLP.Enabled {
		s, err := newOTLPSink(ctx, cfg.OTLP, service, version)
		if err != nil {
			return nil, err
		}
		l.sinks = append(l.sinks, s)
	}
	if !cfg.Webhook.URL.IsZero() {
		s, err := newWebhookSink(ctx, cfg.Webhook, reg)
		if err != nil {
			return nil, err
		}
		l.sinks = append(l.sinks, s)
	}
	for _, opt := range opts {
		opt(l)
	}
	if cfg.Store.Enabled {
		s, err := OpenStore(cfg.Store, func() time.Time { return l.now() })
		if err != nil {
			return nil, err
		}
		l.store = s
		l.sinks = append(l.sinks, s)
	}
	return l, nil
}

// Store is the store of recent events, nil unless audit.store is enabled.
func (l *Logger) Store() *Store {
	if l == nil {
		return nil
	}
	return l.store
}

// Emit fills in the schema, service, time and client of ev and hands it to
// every sink without blocking on delivery.
func (l *Logger) Emit(ctx context.Context, ev Event) {
	if l == nil {
		return
	}
	ev.Schema = Schema
	ev.Service = l.service
	if ev.Time.IsZero() {
		ev.Time = l.now()
	}
	ev.Time = ev.Time.UTC()
	if ev.Result == "" {
		ev.Result = OK
	}
	maps.DeleteFunc(ev.Details, func(_, v string) bool { return v == "" })
	if c, ok := ctx.Value(clientKey{}).(Client); ok {
		ev.ClientIP = cmp.Or(ev.ClientIP, c.IP)
		ev.ForwardedFor = cmp.Or(ev.ForwardedFor, c.ForwardedFor)
		ev.UserAgent = cmp.Or(ev.UserAgent, c.UserAgent)
	}
	emitted.WithLabelValues(string(ev.Action), string(ev.Result)).Inc()
	for _, s := range l.sinks {
		s.Write(ctx, ev)
	}
}

func (l *Logger) Close(ctx context.Context) error {
	if l == nil {
		return nil
	}
	var errs []error
	for _, s := range l.sinks {
		errs = append(errs, s.Close(ctx))
	}
	return errors.Join(errs...)
}

// Client is the network side of whoever triggered an event. ForwardedFor is
// the raw X-Forwarded-For header: only as trustworthy as the proxy in front.
type Client struct {
	IP           string
	ForwardedFor string
	UserAgent    string
}

type clientKey struct{}

func WithClient(ctx context.Context, c Client) context.Context {
	return context.WithValue(ctx, clientKey{}, c)
}

func ClientFromRequest(r *http.Request) Client {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	return Client{IP: ip, ForwardedFor: r.Header.Get("X-Forwarded-For"), UserAgent: r.UserAgent()}
}

// Middleware puts the request's client into its context for Emit.
func Middleware(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.ServeHTTP(w, r.WithContext(WithClient(r.Context(), ClientFromRequest(r))))
	})
}

type field struct {
	key   string
	value any
}

func (ev Event) fields() []field {
	fs := []field{
		{"schema", ev.Schema},
		{"service", ev.Service},
		{"action", string(ev.Action)},
		{"result", string(ev.Result)},
	}
	for _, f := range []field{
		{"actor", ev.Actor},
		{"provider", ev.Provider},
		{"session", ev.Session},
		{"artifact", ev.Artifact},
		{"clientIp", ev.ClientIP},
		{"forwardedFor", ev.ForwardedFor},
		{"userAgent", ev.UserAgent},
		{"reason", ev.Reason},
	} {
		if f.value != "" {
			fs = append(fs, f)
		}
	}
	if ev.Admin {
		fs = append(fs, field{"admin", true})
	}
	if len(ev.Details) > 0 {
		fs = append(fs, field{"details", ev.Details})
	}
	return fs
}

func sortedKeys(m map[string]string) []string {
	return slices.Sorted(maps.Keys(m))
}

type slogSink struct {
	h slog.Handler
}

func newSlogSink(w io.Writer) *slogSink {
	return &slogSink{h: slog.NewJSONHandler(w, nil).WithAttrs([]slog.Attr{slog.String("log", "audit")})}
}

func (s *slogSink) Write(ctx context.Context, ev Event) {
	r := slog.NewRecord(ev.Time, slog.LevelInfo, "audit", 0)
	for _, f := range ev.fields() {
		if d, ok := f.value.(map[string]string); ok {
			attrs := make([]any, 0, len(d))
			for _, k := range sortedKeys(d) {
				attrs = append(attrs, slog.String(k, d[k]))
			}
			r.AddAttrs(slog.Group(f.key, attrs...))
			continue
		}
		r.AddAttrs(slog.Any(f.key, f.value))
	}
	_ = s.h.Handle(ctx, r)
}

func (s *slogSink) Close(context.Context) error { return nil }
