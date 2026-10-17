package api

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kriakiku/holtdroid/internal/config"
)

func TestLoadSources(t *testing.T) {
	cfg := DefaultConfig()
	if err := config.Load("", DefaultConfig(), &cfg); err != nil {
		t.Fatal(err)
	}
	if len(cfg.Sources) != 1 || cfg.Sources[0].Name != "local" || cfg.Sources[0].Filesystem.Dir != "/var/lib/holtdroid/apks" || !cfg.Uploads.Enabled {
		t.Fatalf("defaults %+v %+v", cfg.Sources, cfg.Uploads)
	}

	path := filepath.Join(t.TempDir(), "config.yaml")
	yaml := "uploads:\n  source: mine\n  maxSize: 2GiB\nsources:\n  - name: slack\n    type: s3\n    readOnly: true\n    pollInterval: 1m\n    s3: {endpoint: https://s3.example.com, bucket: apks, prefix: slack}\n  - name: mine\n    filesystem: {dir: /data}\n"
	if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg = DefaultConfig()
	if err := config.Load(path, DefaultConfig(), &cfg); err != nil {
		t.Fatal(err)
	}
	if len(cfg.Sources) != 2 || cfg.Sources[0].S3.Prefix != "slack" || !cfg.Sources[0].ReadOnly || cfg.Sources[0].PollInterval.Minutes() != 1 || cfg.Sources[1].Filesystem.Dir != "/data" {
		t.Fatalf("sources %+v", cfg.Sources)
	}
	if cfg.UploadSource() != "mine" || cfg.Uploads.MaxSize != 2<<30 || cfg.Uploads.Prefix != "uploads" {
		t.Fatalf("uploads %+v", cfg.Uploads)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateSources(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Config)
	}{
		{"bad name", func(c *Config) { c.Sources[0].Name = "Local/1" }},
		{"duplicate", func(c *Config) { c.Sources = append(c.Sources, c.Sources[0]) }},
		{"unknown upload source", func(c *Config) { c.Uploads.Source = "nope" }},
		{"read-only upload source", func(c *Config) { c.Sources[0].ReadOnly = true }},
		{"uploads without sources", func(c *Config) { c.Sources = nil }},
		{"provider named like ssh handles", func(c *Config) { c.Providers = []Endpoint{{Name: "user", URL: "http://p"}} }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := DefaultConfig()
			tt.mutate(&cfg)
			if cfg.Validate() == nil {
				t.Fatal("expected an error")
			}
		})
	}
	cfg := DefaultConfig()
	cfg.Sources, cfg.Uploads.Enabled = nil, false
	if err := cfg.Validate(); err != nil {
		t.Fatalf("no sources and no uploads is fine: %v", err)
	}
}
