package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"golang.org/x/sync/errgroup"

	"github.com/kriakiku/holtdroid/internal/audit"
	"github.com/kriakiku/holtdroid/internal/config"
	"github.com/kriakiku/holtdroid/internal/secrets"
	"github.com/kriakiku/holtdroid/internal/telemetry"
)

var version = "dev"

type common struct {
	configPath string
	logLevel   string
	logFormat  string
}

func main() {
	var c common
	root := &cobra.Command{
		Use:           "holtdroid",
		Short:         "Browser-based Android sandboxes for testing APKs",
		Version:       version,
		SilenceUsage:  true,
		SilenceErrors: true,
		PersistentPreRunE: func(*cobra.Command, []string) error {
			return setupLogging(c.logLevel, c.logFormat)
		},
	}
	root.PersistentFlags().StringVarP(&c.configPath, "config", "c", "", "path to a YAML config file")
	root.PersistentFlags().StringVar(&c.logLevel, "log-level", envOr("HOLTDROID_LOG_LEVEL", "info"), "debug, info, warn or error")
	root.PersistentFlags().StringVar(&c.logFormat, "log-format", envOr("HOLTDROID_LOG_FORMAT", "json"), "json or text")

	root.AddCommand(apiCmd(&c), providerFakeCmd(&c), providerEmulatorCmd(&c), providerPhysicalCmd(&c), agentCmd(&c), sshGatewayCmd(&c), devCmd(), openapiCmd())

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	err := root.ExecuteContext(ctx)
	stop()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

func setupLogging(level, format string) error {
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(level)); err != nil {
		return err
	}
	opts := &slog.HandlerOptions{Level: lvl}
	switch strings.ToLower(format) {
	case "json":
		slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, opts)))
	case "text":
		slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, opts)))
	default:
		return fmt.Errorf("unknown log format %q", format)
	}
	return nil
}

type secretsConfig struct {
	OpenBao secrets.OpenBaoConfig
}

type shared struct {
	Secrets   secretsConfig
	Telemetry telemetry.Config
	Audit     audit.Config
}

// runtime holds what every component reads from the shared sections of its
// config file: secrets, telemetry and audit.
type runtime struct {
	secrets   *secrets.Registry
	telemetry telemetry.Config
	audit     audit.Config
}

func defaultRuntime() runtime {
	return runtime{secrets: secrets.NewRegistry(), telemetry: telemetry.DefaultConfig(), audit: audit.DefaultConfig()}
}

// loadConfig reads cfg (pre-filled with defaults) and the same file's
// "secrets", "telemetry" and "audit" sections.
func loadConfig[T any](path string, cfg *T) (runtime, error) {
	if err := config.Load(path, *cfg, cfg); err != nil {
		return runtime{}, err
	}
	sc := shared{Telemetry: telemetry.DefaultConfig(), Audit: audit.DefaultConfig()}
	if err := config.Load(path, sc, &sc); err != nil {
		return runtime{}, err
	}
	rt := runtime{secrets: secrets.NewRegistry(), telemetry: sc.Telemetry, audit: sc.Audit}
	if sc.Secrets.OpenBao.Address != "" {
		rt.secrets.Register("openbao", secrets.NewOpenBao(sc.Secrets.OpenBao, rt.secrets, nil))
	}
	return rt, nil
}

func (rt runtime) auditLogger(ctx context.Context, service string, opts ...audit.Option) (*audit.Logger, error) {
	return audit.New(ctx, rt.audit, service, version, rt.secrets, opts...)
}

type listener struct {
	addr    string
	handler http.Handler
}

// serve runs HTTP servers and background loops until ctx ends, then shuts the
// servers down gracefully. Requests are traced and, with
// telemetry.metrics.listen set, Prometheus metrics are served there.
func (rt runtime) serve(ctx context.Context, service string, listeners []listener, loops ...func(context.Context)) error {
	shutdown, err := telemetry.Setup(ctx, rt.telemetry, service, version)
	if err != nil {
		return err
	}
	defer func() {
		sctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = shutdown(sctx)
	}()
	for i, l := range listeners {
		listeners[i].handler = telemetry.Handler(l.handler, service)
	}
	if addr := rt.telemetry.Metrics.Listen; addr != "" {
		listeners = append(listeners, listener{addr, telemetry.MetricsHandler()})
	}
	g, ctx := errgroup.WithContext(ctx)
	for _, l := range listeners {
		srv := &http.Server{
			Addr:              l.addr,
			Handler:           l.handler,
			ReadHeaderTimeout: 10 * time.Second,
			BaseContext:       func(net.Listener) context.Context { return ctx },
		}
		g.Go(func() error {
			slog.Info("listening", "addr", l.addr)
			if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
				return err
			}
			return nil
		})
		g.Go(func() error {
			<-ctx.Done()
			shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			defer cancel()
			return srv.Shutdown(shutdownCtx)
		})
	}
	for _, loop := range loops {
		g.Go(func() error {
			loop(ctx)
			return nil
		})
	}
	return g.Wait()
}
