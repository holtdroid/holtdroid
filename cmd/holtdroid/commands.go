package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/kriakiku/holtdroid/internal/agent"
	"github.com/kriakiku/holtdroid/internal/agent/emulator"
	"github.com/kriakiku/holtdroid/internal/api"
	"github.com/kriakiku/holtdroid/internal/audit"
	"github.com/kriakiku/holtdroid/internal/contract"
	emulatorprovider "github.com/kriakiku/holtdroid/internal/provider/emulator"
	"github.com/kriakiku/holtdroid/internal/provider/fake"
	"github.com/kriakiku/holtdroid/internal/source"
	"github.com/kriakiku/holtdroid/internal/sshgateway"
	"github.com/kriakiku/holtdroid/internal/storage"
	"github.com/kriakiku/holtdroid/web"
)

func apiCmd(c *common) *cobra.Command {
	return &cobra.Command{
		Use:   "api",
		Short: "Run the portal: web UI, REST API, session proxy and reaper",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg := api.DefaultConfig()
			rt, err := loadConfig(c.configPath, &cfg)
			if err != nil {
				return err
			}
			aud, err := rt.auditLogger(cmd.Context(), "api")
			if err != nil {
				return err
			}
			defer closeAudit(aud)
			srv, err := api.New(cmd.Context(), cfg, api.WithUI(web.FS()), api.WithSecrets(rt.secrets), api.WithAudit(aud))
			if err != nil {
				return err
			}
			defer srv.Close()
			return rt.serve(cmd.Context(), "api", []listener{
				{cfg.Listen, srv.Handler()},
				{cfg.InternalListen, srv.InternalHandler()},
			}, srv.Run)
		},
	}
}

func providerFakeCmd(c *common) *cobra.Command {
	return &cobra.Command{
		Use:   "provider-fake",
		Short: "Run a device provider with simulated devices (development only)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg := fake.DefaultConfig()
			rt, err := loadConfig(c.configPath, &cfg)
			if err != nil {
				return err
			}
			p := fake.New(cfg)
			mux := http.NewServeMux()
			contract.RegisterProvider(contract.NewAPI(mux, "Holtdroid fake provider"), p)
			mux.Handle("/agents/", p.AgentHandler())
			return rt.serve(cmd.Context(), "provider", []listener{{cfg.Listen, mux}, {cfg.TunnelListen, p.TunnelHandler()}})
		},
	}
}

func providerEmulatorCmd(c *common) *cobra.Command {
	return &cobra.Command{
		Use:   "provider-emulator",
		Short: "Run the device provider that starts Android emulator Pods on Kubernetes",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg := emulatorprovider.DefaultConfig()
			rt, err := loadConfig(c.configPath, &cfg)
			if err != nil {
				return err
			}
			kube, err := emulatorprovider.Client(cfg)
			if err != nil {
				return err
			}
			p, err := emulatorprovider.New(cfg, kube, rt.secrets)
			if err != nil {
				return err
			}
			mux := http.NewServeMux()
			contract.RegisterProvider(contract.NewAPI(mux, "Holtdroid emulator provider"), p)
			return rt.serve(cmd.Context(), "provider", []listener{{cfg.Listen, mux}}, p.RefreshPrepull)
		},
	}
}

func agentCmd(c *common) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "agent",
		Short: "Run the device agent inside a session: emulator, app under Frida, screen and DevTools",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg := agent.DefaultConfig()
			rt, err := loadConfig(c.configPath, &cfg)
			if err != nil {
				return err
			}
			if cfg.ArtifactURL == "" || cfg.Package == "" {
				return errors.New("artifactURL and package are required")
			}
			cfg.Version = version
			log := slog.Default()
			inst, err := agent.NewFrida(cfg.Serial, cfg.Script, log)
			if err != nil {
				return err
			}
			adb := agent.ADB{Bin: cfg.ADB, Serial: cfg.Serial}
			a := agent.New(cfg, adb, inst, emulator.New(cfg.Emulator, adb, log).Run, log)
			return rt.serve(cmd.Context(), "agent", []listener{{cfg.Listen, a.Handler()}, {cfg.TunnelListen, a.TunnelHandler()}}, a.Run)
		},
	}
	cmd.AddCommand(&cobra.Command{
		Use:    "compile-scripts DIR",
		Short:  "Bundle the Frida scripts in DIR into the JavaScript the agent loads (used by the session image build)",
		Args:   cobra.ExactArgs(1),
		Hidden: true,
		RunE: func(_ *cobra.Command, args []string) error {
			return agent.CompileScripts(args[0])
		},
	})
	return cmd
}

func sshGatewayCmd(c *common) *cobra.Command {
	return &cobra.Command{
		Use:   "ssh-gateway",
		Short: "Run the SSH gateway: ADB and published-port tunnels into sessions, no shells",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg := sshgateway.DefaultConfig()
			rt, err := loadConfig(c.configPath, &cfg)
			if err != nil {
				return err
			}
			log := slog.Default().With("component", "ssh-gateway")
			hostKey, err := sshgateway.HostKey(cmd.Context(), rt.secrets, cfg.HostKey, log)
			if err != nil {
				return err
			}
			aud, err := rt.auditLogger(cmd.Context(), "ssh-gateway")
			if err != nil {
				return err
			}
			defer closeAudit(aud)
			keys := sshgateway.NewKeys(cfg.KeyTTL, nil)
			g, err := sshgateway.New(cfg, hostKey, keys, contract.NewSSHSessionsClient(cfg.APIURL, nil), aud, log)
			if err != nil {
				return err
			}
			var lc net.ListenConfig
			ln, err := lc.Listen(cmd.Context(), "tcp", cfg.Listen)
			if err != nil {
				return err
			}
			mux := http.NewServeMux()
			contract.RegisterSSHGateway(contract.NewAPI(mux, "Holtdroid ssh-gateway"), keys)
			return rt.serve(cmd.Context(), "ssh-gateway", []listener{{cfg.HTTPListen, mux}}, func(ctx context.Context) { g.Serve(ctx, ln) })
		},
	}
}

func devCmd() *cobra.Command {
	var (
		listen    string
		agents    string
		sshKeys   string
		sshListen string
		tunnels   string
		apks      string
		uploads   string
		cacheDir  string
		authMode  string
		password  string
		slots     int
		idle      time.Duration
		stepDelay time.Duration
		noDirect  bool
		location  string
		metrics   string
	)
	cmd := &cobra.Command{
		Use:   "dev",
		Short: "Run the api with a directory source and fake devices (local development)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			for _, dir := range []*string{&cacheDir, &uploads} {
				if *dir == "" {
					tmp, err := os.MkdirTemp("", "holtdroid-dev-")
					if err != nil {
						return err
					}
					defer os.RemoveAll(tmp)
					*dir = tmp
				}
			}
			absAPKs, err := filepath.Abs(apks)
			if err != nil {
				return err
			}

			provider := fake.New(fake.Config{Slots: slots, PublicURL: "http://localhost" + agents, TunnelURL: "http://localhost" + tunnels, StepDelay: stepDelay, NoDirect: noDirect, DefaultLocation: location})
			keys := sshgateway.NewKeys(24*time.Hour, nil)
			gateway := http.NewServeMux()
			contract.RegisterSSHGateway(contract.NewAPI(gateway, "Holtdroid ssh-gateway keys"), keys)
			var lc net.ListenConfig
			sshLn, err := lc.Listen(cmd.Context(), "tcp", sshListen)
			if err != nil {
				return err
			}
			_, sshPort, _ := net.SplitHostPort(sshLn.Addr().String())

			cfg := api.DefaultConfig()
			cfg.Listen = listen
			cfg.Auth.Mode = authMode
			if password != "" {
				_ = os.Setenv("HOLTDROID_DEV_PASSWORD", password)
				cfg.Auth.Password = "env:HOLTDROID_DEV_PASSWORD"
			}
			cfg.Storage.Filesystem.Dir = cacheDir
			cfg.Sessions.IdleTimeout = idle
			cfg.InternalURL = "http://localhost" + cfg.InternalListen
			cfg.SSH.Enabled = true
			cfg.SSH.GatewayURL = "http://127.0.0.1" + sshKeys
			if cfg.SSH.PublicPort, err = strconv.Atoi(sshPort); err != nil {
				return fmt.Errorf("ssh port: %w", err)
			}
			cfg.Sources = []source.Config{
				{Name: "local", Type: "filesystem", Filesystem: storage.FilesystemConfig{Dir: absAPKs}, ReadOnly: true, PollInterval: 5 * time.Second},
				{Name: "uploads", Type: "filesystem", Filesystem: storage.FilesystemConfig{Dir: uploads}, PollInterval: 5 * time.Second},
			}
			cfg.Uploads.Source = "uploads"
			rt := defaultRuntime()
			rt.telemetry.Metrics.Listen = metrics
			aud, err := rt.auditLogger(cmd.Context(), "api")
			if err != nil {
				return err
			}
			defer closeAudit(aud)
			srv, err := api.New(cmd.Context(), cfg, api.WithUI(web.FS()), api.WithProvider("fake", provider), api.WithAudit(aud))
			if err != nil {
				return err
			}
			defer srv.Close()
			gcfg := sshgateway.DefaultConfig()
			gcfg.APIURL = cfg.InternalURL
			gcfg.PortalURL = "http://localhost" + listen
			if !strings.HasPrefix(listen, ":") {
				gcfg.PortalURL = "http://" + listen
			}
			log := slog.Default().With("component", "ssh-gateway")
			hostKey, err := sshgateway.HostKey(cmd.Context(), nil, "", log)
			if err != nil {
				return err
			}
			g, err := sshgateway.New(gcfg, hostKey, keys, srv, aud, log)
			if err != nil {
				return err
			}
			return rt.serve(cmd.Context(), "dev", []listener{
				{cfg.Listen, srv.Handler()},
				{cfg.InternalListen, srv.InternalHandler()},
				{agents, provider.AgentHandler()},
				{tunnels, provider.TunnelHandler()},
				{sshKeys, gateway},
			}, srv.Run, func(ctx context.Context) { g.Serve(ctx, sshLn) })
		},
	}
	cmd.Flags().StringVar(&listen, "listen", ":8080", "portal address")
	cmd.Flags().StringVar(&agents, "agents", ":8090", "address for the fake device agents")
	cmd.Flags().StringVar(&sshKeys, "ssh-keys", ":8092", "address for the in-process ssh-gateway key API")
	cmd.Flags().StringVar(&sshListen, "ssh", ":2222", "address for the in-process ssh-gateway")
	cmd.Flags().StringVar(&tunnels, "tunnels", ":8091", "address for the fake device agents' tunnel endpoints")
	cmd.Flags().StringVar(&apks, "apks", "internal/apk/testdata", "read-only directory with APKs to list")
	cmd.Flags().StringVar(&uploads, "uploads", "", "directory for uploaded APKs (default: a temporary directory)")
	cmd.Flags().StringVar(&cacheDir, "cache", "", "APK cache directory (default: a temporary directory)")
	cmd.Flags().StringVar(&authMode, "auth", "anonymous", "sign-in mode: anonymous, password or none")
	cmd.Flags().StringVar(&password, "password", "", "shared password for --auth password")
	cmd.Flags().IntVar(&slots, "slots", 4, "number of fake device slots")
	cmd.Flags().DurationVar(&idle, "idle-timeout", 30*time.Minute, "session idle timeout")
	cmd.Flags().DurationVar(&stepDelay, "step-delay", 2*time.Second, "delay between fake boot stages")
	cmd.Flags().BoolVar(&noDirect, "no-direct", false, "fake devices offer no direct (VPN-less) location")
	cmd.Flags().StringVar(&location, "default-location", "", "location fake sessions start in (default: the first offered)")
	cmd.Flags().StringVar(&metrics, "metrics", "", "address for Prometheus metrics (default: off)")
	return cmd
}

func closeAudit(aud *audit.Logger) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := aud.Close(ctx); err != nil {
		slog.Warn("audit sinks did not flush", "err", err)
	}
}

func openapiCmd() *cobra.Command {
	return &cobra.Command{
		Use:       "openapi [api|agent]",
		Short:     "Print an OpenAPI document (used to generate the web client)",
		Args:      cobra.MatchAll(cobra.MaximumNArgs(1), cobra.OnlyValidArgs),
		ValidArgs: []string{"api", "agent"},
		RunE: func(cmd *cobra.Command, args []string) error {
			doc := api.OpenAPI()
			if len(args) == 1 && args[0] == "agent" {
				doc = contract.AgentOpenAPI()
			}
			enc := json.NewEncoder(cmd.OutOrStdout())
			enc.SetIndent("", "  ")
			return enc.Encode(doc)
		},
	}
}
