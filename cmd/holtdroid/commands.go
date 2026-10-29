package main

import (
	"cmp"
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
	"time"

	"github.com/spf13/cobra"

	"github.com/holtdroid/holtdroid/internal/agent"
	"github.com/holtdroid/holtdroid/internal/agent/redroid"
	"github.com/holtdroid/holtdroid/internal/api"
	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/db"
	"github.com/holtdroid/holtdroid/internal/hostinfo"
	emulatorprovider "github.com/holtdroid/holtdroid/internal/provider/emulator"
	"github.com/holtdroid/holtdroid/internal/provider/fake"
	"github.com/holtdroid/holtdroid/internal/provider/physical"
	"github.com/holtdroid/holtdroid/internal/source"
	"github.com/holtdroid/holtdroid/internal/sshgateway"
	"github.com/holtdroid/holtdroid/internal/storage"
	"github.com/holtdroid/holtdroid/internal/users"
	"github.com/holtdroid/holtdroid/web"
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

func providerPhysicalCmd(c *common) *cobra.Command {
	return &cobra.Command{
		Use:   "provider-physical",
		Short: "Run the device provider for phones plugged into this host over USB (root optional, per phone)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg := physical.DefaultConfig()
			rt, err := loadConfig(c.configPath, &cfg)
			if err != nil {
				return err
			}
			p, err := physical.New(cfg, physical.ADBHost{Bin: cfg.ADB.Bin, Phone: cfg.Phone}, physical.WithVersion(version), physical.WithSecrets(rt.secrets))
			if err != nil {
				return err
			}
			mux := http.NewServeMux()
			contract.RegisterProvider(contract.NewAPI(mux, "Holtdroid physical provider"), p)
			mux.Handle("/agents/", p.AgentHandler())
			return rt.serve(cmd.Context(), "provider", []listener{{cfg.Listen, mux}, {cfg.TunnelListen, p.TunnelHandler()}}, p.Run)
		},
	}
}

type nodeInfoConfig struct {
	Listen string
}

func nodeInfoCmd(c *common) *cobra.Command {
	return &cobra.Command{
		Use:   "node-info",
		Short: "Describe this machine to the emulator provider: CPU, memory, load and temperature sensors",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg := nodeInfoConfig{Listen: ":8090"}
			rt, err := loadConfig(c.configPath, &cfg)
			if err != nil {
				return err
			}
			mux := http.NewServeMux()
			contract.RegisterNode(contract.NewAPI(mux, "Holtdroid node info"), hostinfo.Node{Root: os.DirFS("/")})
			return rt.serve(cmd.Context(), "node-info", []listener{{cfg.Listen, mux}})
		},
	}
}

func sessionDevicesCmd(c *common) *cobra.Command {
	return &cobra.Command{
		Use:   "session-devices",
		Short: "Run the NRI plugin that gives unprivileged redroid containers on this node their devices",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg := emulatorprovider.DefaultDevicesConfig()
			if _, err := loadConfig(c.configPath, &cfg); err != nil {
				return err
			}
			return emulatorprovider.RunDevicePlugin(cmd.Context(), cfg)
		},
	}
}

func agentCmd(c *common) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "agent",
		Short: "Run the device agent inside a session: redroid over adb, app under Frida, screen and DevTools",
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
			inst, err := agent.NewFrida(agent.FridaConfig{Serial: cfg.Serial, Host: cfg.FridaHost, Dir: cfg.Script, Gating: cfg.SpawnGating}, log)
			if err != nil {
				return err
			}
			adb := agent.ADB{Bin: cfg.ADB, Serial: cfg.Serial}
			a := agent.New(cfg, adb, inst, redroid.New(cfg.Redroid, adb, log).Run, log)
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
			sessions := contract.NewSSHSessionsClient(cfg.APIURL, nil)
			rt.audit.Store.Enabled = false
			var opts []audit.Option
			if rt.audit.Forward {
				opts = append(opts, audit.WithForward(cmd.Context(), rt.audit.Webhook, sessions.RecordAudit))
			}
			aud, err := rt.auditLogger(cmd.Context(), "ssh-gateway", opts...)
			if err != nil {
				return err
			}
			defer closeAudit(aud)
			g, err := sshgateway.New(cfg, hostKey, sessions, aud, log)
			if err != nil {
				return err
			}
			var lc net.ListenConfig
			ln, err := lc.Listen(cmd.Context(), "tcp", cfg.Listen)
			if err != nil {
				return err
			}
			mux := http.NewServeMux()
			contract.RegisterSSHGateway(contract.NewAPI(mux, "Holtdroid ssh-gateway"), g)
			return rt.serve(cmd.Context(), "ssh-gateway", []listener{{cfg.HTTPListen, mux}}, func(ctx context.Context) { g.Serve(ctx, ln) })
		},
	}
}

func devCmd() *cobra.Command {
	var (
		listen    string
		agents    string
		sshAPI    string
		clientDir string
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
			var lc net.ListenConfig
			sshLn, err := lc.Listen(cmd.Context(), "tcp", sshListen)
			if err != nil {
				return err
			}
			_, sshPort, _ := net.SplitHostPort(sshLn.Addr().String())

			cfg := api.DefaultConfig()
			cfg.Listen = listen
			cfg.DevTools.Frontend = ""
			cfg.Auth.Mode = authMode
			if authMode == auth.ModeUsers && cfg.PublicURL == "" {
				cfg.PublicURL = "http://localhost" + listen
			}
			if password != "" {
				_ = os.Setenv("HOLTDROID_DEV_PASSWORD", password)
				cfg.Auth.Password = "env:HOLTDROID_DEV_PASSWORD"
			}
			cfg.Storage.Filesystem.Dir = cacheDir
			cfg.Sessions.IdleTimeout = idle
			cfg.InternalURL = "http://localhost" + cfg.InternalListen
			cfg.SSH.Enabled = true
			cfg.SSH.GatewayURL = "http://127.0.0.1" + sshAPI
			cfg.SSH.ClientDir = clientDir
			if cfg.SSH.PublicPort, err = strconv.Atoi(sshPort); err != nil {
				return fmt.Errorf("ssh port: %w", err)
			}
			cfg.Sources = []source.Config{
				{Name: "local", Type: "filesystem", Filesystem: storage.FilesystemConfig{Dir: absAPKs}, ReadOnly: true, PollInterval: 5 * time.Second},
				{Name: "uploads", Type: "filesystem", Filesystem: storage.FilesystemConfig{Dir: uploads}, PollInterval: 5 * time.Second},
			}
			cfg.Uploads.Source = "uploads"
			cfg.AppData.Enabled = true
			cfg.AppData.Cache = true
			cfg.Recordings.Enabled = true
			cfg.Recordings.Quota = 2 << 30
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
			log := slog.Default().With("component", "ssh-gateway")
			hostKey, err := sshgateway.HostKey(cmd.Context(), nil, "", log)
			if err != nil {
				return err
			}
			g, err := sshgateway.New(gcfg, hostKey, srv, aud, log)
			if err != nil {
				return err
			}
			gateway := http.NewServeMux()
			contract.RegisterSSHGateway(contract.NewAPI(gateway, "Holtdroid ssh-gateway"), g)
			return rt.serve(cmd.Context(), "dev", []listener{
				{cfg.Listen, srv.Handler()},
				{cfg.InternalListen, srv.InternalHandler()},
				{agents, provider.AgentHandler()},
				{tunnels, provider.TunnelHandler()},
				{sshAPI, gateway},
			}, srv.Run, func(ctx context.Context) { g.Serve(ctx, sshLn) })
		},
	}
	cmd.Flags().StringVar(&listen, "listen", ":8080", "portal address")
	cmd.Flags().StringVar(&agents, "agents", ":8090", "address for the fake device agents")
	cmd.Flags().StringVar(&sshAPI, "ssh-api", ":8092", "address for the in-process ssh-gateway's internal API")
	cmd.Flags().StringVar(&clientDir, "connect-clients", "bin/connect", "directory with the client builds (holtdroid-{os}-{arch}) served to tunnel.sh")
	cmd.Flags().StringVar(&sshListen, "ssh", ":2222", "address for the in-process ssh-gateway")
	cmd.Flags().StringVar(&tunnels, "tunnels", ":8091", "address for the fake device agents' tunnel endpoints")
	cmd.Flags().StringVar(&apks, "apks", "internal/apk/testdata", "read-only directory with APKs to list")
	cmd.Flags().StringVar(&uploads, "uploads", "", "directory for uploaded APKs (default: a temporary directory)")
	cmd.Flags().StringVar(&cacheDir, "cache", "", "APK cache directory (default: a temporary directory)")
	cmd.Flags().StringVar(&authMode, "auth", "anonymous", "sign-in mode: anonymous, password, users (passkeys; the first admin link is logged) or none")
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

// openUsers opens the api's SQLite file without a replica of its own: the
// running api in the same container keeps streaming the changes.
func openUsers(ctx context.Context, c *common) (*users.Service, *db.DB, api.Config, runtime, error) {
	cfg := api.DefaultConfig()
	rt, err := loadConfig(c.configPath, &cfg)
	if err != nil {
		return nil, nil, cfg, rt, err
	}
	if cfg.Auth.Mode != auth.ModeUsers || cfg.Database.Type != "sqlite" {
		return nil, nil, cfg, rt, errors.New("needs auth.mode users and database.type sqlite")
	}
	if _, err := os.Stat(cfg.Database.Path); err != nil {
		return nil, nil, cfg, rt, fmt.Errorf("no database at %s: run this in the api's container: %w", cfg.Database.Path, err)
	}
	dbCfg := cfg.Database
	dbCfg.Replica = storage.Config{}
	d, err := db.Open(ctx, dbCfg, rt.secrets)
	if err != nil {
		return nil, nil, cfg, rt, err
	}
	svc, err := users.New(d, cfg.Auth.Users, cfg.PublicURL, time.Now)
	if err != nil {
		_ = d.Close()
		return nil, nil, cfg, rt, err
	}
	return svc, d, cfg, rt, nil
}

func usersCmd(c *common) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "users",
		Short: "Manage the users auth mode from the api's container",
		Long: "Run inside the api container: kubectl exec deploy/holtdroid-api -- holtdroid users … --config /etc/holtdroid/config.yaml. " +
			"The commands write to the api's SQLite file, whose replica the running api keeps streaming.",
	}
	var (
		email, name, role string
		sessionTTL, ttl   time.Duration
		maxSessions       int64
	)

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "Print every user: id, role, email and name",
		RunE: func(cmd *cobra.Command, _ []string) error {
			svc, d, _, _, err := openUsers(cmd.Context(), c)
			if err != nil {
				return err
			}
			defer d.Close()
			list, err := svc.List(cmd.Context())
			if err != nil {
				return err
			}
			for _, u := range list {
				fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\t%s\t%s\n", u.ID, cmp.Or(u.Role, "pending"), u.Email, u.Name)
			}
			return nil
		},
	}

	createCmd := &cobra.Command{
		Use:   "create",
		Short: "Add a user without a passkey, e.g. a bot that signs in with users session",
		RunE: func(cmd *cobra.Command, _ []string) error {
			svc, d, _, _, err := openUsers(cmd.Context(), c)
			if err != nil {
				return err
			}
			defer d.Close()
			var limits users.Overrides
			if maxSessions >= 0 {
				limits.MaxSessions = &maxSessions
			}
			u, err := svc.Create(cmd.Context(), name, email, role, limits)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\t%s\t%s\n", u.ID, cmp.Or(u.Role, "pending"), u.Email, u.Name)
			return nil
		},
	}
	createCmd.Flags().StringVar(&name, "name", "", "display name")
	createCmd.Flags().StringVar(&role, "role", users.RoleUser, "admin, user, or empty for waiting for approval")
	createCmd.Flags().Int64Var(&maxSessions, "max-sessions", -1, "devices the user may run at once, 0 for no limit; default: the role's")

	sessionCmd := &cobra.Command{
		Use:   "session",
		Short: "Print a session cookie value for a user, to call the API as them",
		Long:  "Prints the value of the auth.cookieName cookie (holtdroid_session by default), e.g. for curl -b \"holtdroid_session=$VALUE\".",
		RunE: func(cmd *cobra.Command, _ []string) error {
			svc, d, cfg, rt, err := openUsers(cmd.Context(), c)
			if err != nil {
				return err
			}
			defer d.Close()
			id, err := svc.IdentityFor(cmd.Context(), email)
			if err != nil {
				return err
			}
			if sessionTTL > 0 {
				cfg.Auth.SessionTTL = sessionTTL
			}
			a, err := auth.New(cmd.Context(), cfg.Auth, rt.secrets, cfg.PublicURL)
			if err != nil {
				return err
			}
			cookie, err := a.SessionCookie(id)
			if err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), cookie.Value)
			return nil
		},
	}
	sessionCmd.Flags().DurationVar(&sessionTTL, "ttl", 0, "how long the session lasts; default auth.sessionTTL")

	recoverCmd := &cobra.Command{
		Use:   "recover",
		Short: "Print a recovery link that lets a user register a new passkey",
		RunE: func(cmd *cobra.Command, _ []string) error {
			svc, d, _, _, err := openUsers(cmd.Context(), c)
			if err != nil {
				return err
			}
			defer d.Close()
			link, expires, err := svc.RecoveryLinkFor(cmd.Context(), email, ttl, "cli")
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "%s\nvalid until %s, single use\n", link, expires.Format(time.RFC3339))
			return nil
		},
	}
	recoverCmd.Flags().DurationVar(&ttl, "ttl", 24*time.Hour, "how long the link stays valid (up to 720h)")

	for _, sub := range []*cobra.Command{createCmd, sessionCmd, recoverCmd} {
		sub.Flags().StringVar(&email, "email", "", "the user's email")
		_ = sub.MarkFlagRequired("email")
	}
	cmd.AddCommand(listCmd, createCmd, sessionCmd, recoverCmd)
	return cmd
}
