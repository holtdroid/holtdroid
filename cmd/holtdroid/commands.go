package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"

	"github.com/kriakiku/holtdroid/internal/api"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/provider/fake"
	"github.com/kriakiku/holtdroid/internal/source/dir"
	"github.com/kriakiku/holtdroid/internal/sshgateway"
	"github.com/kriakiku/holtdroid/web"
)

func apiCmd(c *common) *cobra.Command {
	return &cobra.Command{
		Use:   "api",
		Short: "Run the portal: web UI, REST API, session proxy and reaper",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg := api.DefaultConfig()
			reg, err := loadConfig(c.configPath, &cfg)
			if err != nil {
				return err
			}
			srv, err := api.New(cmd.Context(), cfg, api.WithUI(web.FS()), api.WithSecrets(reg))
			if err != nil {
				return err
			}
			return serve(cmd.Context(), []listener{
				{cfg.Listen, srv.Handler()},
				{cfg.InternalListen, srv.InternalHandler()},
			}, srv.Run)
		},
	}
}

func sourceDirCmd(c *common) *cobra.Command {
	return &cobra.Command{
		Use:   "source-dir",
		Short: "Run an artifact source that serves APKs from a directory",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg := dir.DefaultConfig()
			if _, err := loadConfig(c.configPath, &cfg); err != nil {
				return err
			}
			mux := http.NewServeMux()
			contract.RegisterSource(contract.NewAPI(mux, "Holtdroid directory source"), dir.New(cfg.Path))
			return serve(cmd.Context(), []listener{{cfg.Listen, mux}})
		},
	}
}

func providerFakeCmd(c *common) *cobra.Command {
	return &cobra.Command{
		Use:   "provider-fake",
		Short: "Run a device provider with simulated devices (development only)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg := fake.DefaultConfig()
			if _, err := loadConfig(c.configPath, &cfg); err != nil {
				return err
			}
			p := fake.New(cfg)
			mux := http.NewServeMux()
			contract.RegisterProvider(contract.NewAPI(mux, "Holtdroid fake provider"), p)
			mux.Handle("/agents/", p.AgentHandler())
			return serve(cmd.Context(), []listener{{cfg.Listen, mux}})
		},
	}
}

func devCmd() *cobra.Command {
	var (
		listen    string
		agents    string
		sshKeys   string
		apks      string
		cacheDir  string
		authMode  string
		password  string
		slots     int
		idle      time.Duration
		stepDelay time.Duration
	)
	cmd := &cobra.Command{
		Use:   "dev",
		Short: "Run the api with a directory source and fake devices (local development)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if cacheDir == "" {
				var err error
				if cacheDir, err = os.MkdirTemp("", "holtdroid-cache-"); err != nil {
					return err
				}
				defer os.RemoveAll(cacheDir)
			}
			absAPKs, err := filepath.Abs(apks)
			if err != nil {
				return err
			}

			provider := fake.New(fake.Config{Slots: slots, PublicURL: "http://localhost" + agents, StepDelay: stepDelay})
			gateway := http.NewServeMux()
			contract.RegisterSSHGateway(contract.NewAPI(gateway, "Holtdroid ssh-gateway keys"), sshgateway.NewKeys(24*time.Hour, nil))

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
			srv, err := api.New(cmd.Context(), cfg,
				api.WithUI(web.FS()),
				api.WithSource("local", dir.New(absAPKs)),
				api.WithProvider("fake", provider),
			)
			if err != nil {
				return err
			}
			return serve(cmd.Context(), []listener{
				{cfg.Listen, srv.Handler()},
				{cfg.InternalListen, srv.InternalHandler()},
				{agents, provider.AgentHandler()},
				{sshKeys, gateway},
			}, srv.Run)
		},
	}
	cmd.Flags().StringVar(&listen, "listen", ":8080", "portal address")
	cmd.Flags().StringVar(&agents, "agents", ":8090", "address for the fake device agents")
	cmd.Flags().StringVar(&sshKeys, "ssh-keys", ":8092", "address for the in-process ssh-gateway key API")
	cmd.Flags().StringVar(&apks, "apks", "internal/apk/testdata", "directory with APKs to list")
	cmd.Flags().StringVar(&cacheDir, "cache", "", "APK cache directory (default: a temporary directory)")
	cmd.Flags().StringVar(&authMode, "auth", "anonymous", "sign-in mode: anonymous, password or none")
	cmd.Flags().StringVar(&password, "password", "", "shared password for --auth password")
	cmd.Flags().IntVar(&slots, "slots", 4, "number of fake device slots")
	cmd.Flags().DurationVar(&idle, "idle-timeout", 30*time.Minute, "session idle timeout")
	cmd.Flags().DurationVar(&stepDelay, "step-delay", 2*time.Second, "delay between fake boot stages")
	return cmd
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
