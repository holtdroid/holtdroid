package api

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"time"

	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/config"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/db"
	"github.com/kriakiku/holtdroid/internal/rules"
	"github.com/kriakiku/holtdroid/internal/secrets"
	"github.com/kriakiku/holtdroid/internal/source"
	"github.com/kriakiku/holtdroid/internal/storage"
)

type Endpoint struct {
	Name string
	URL  string
}

type SessionsConfig struct {
	IdleTimeout   time.Duration
	MaxTTL        time.Duration
	ReapInterval  time.Duration
	FlushInterval time.Duration
}

type CacheConfig struct {
	MaxSize config.ByteSize
	Warm    int
}

type UploadsConfig struct {
	Enabled      bool
	Source       string
	Prefix       string
	MaxSize      config.ByteSize
	TemporaryTTL time.Duration
}

type DownloadsConfig struct {
	AdminOnly bool
}

type SSHConfig struct {
	Enabled                 bool
	GatewayURL              string
	PublicHost              string
	PublicPort              int
	AllowADB                bool
	AllowReverse            bool
	MaxTunnelsPerConnection int
	CAKey                   secrets.Ref
	CodeTTL                 time.Duration
	CertificateTTL          time.Duration
	RefreshTTL              time.Duration
	ClientDir               string
	InsecureTLS             bool
}

type AppDataConfig struct {
	Enabled      bool
	Storage      storage.Config
	Keep         int
	MaxAge       time.Duration
	Cache        bool
	MaxCacheSize config.ByteSize
	MaxSize      config.ByteSize
	Export       bool
	Timeout      time.Duration
}

// ADBConfig controls the browser's ADB connection to sessions (the portal's
// logcat, files, terminal and app tools).
type ADBConfig struct {
	Browser   bool
	OwnerOnly bool
}

type Config struct {
	Listen         string
	InternalListen string
	PublicURL      string
	InternalURL    string
	Auth           auth.Config
	Sessions       SessionsConfig
	Storage        storage.Config
	Database       db.Config
	Cache          CacheConfig
	SSH            SSHConfig
	ADB            ADBConfig
	Uploads        UploadsConfig
	Downloads      DownloadsConfig
	AppData        AppDataConfig
	Sources        []source.Config
	Providers      []Endpoint
}

func DefaultConfig() Config {
	return Config{
		Listen:         ":8080",
		InternalListen: ":8081",
		InternalURL:    "http://localhost:8081",
		Auth:           auth.DefaultConfig(),
		Sessions: SessionsConfig{
			IdleTimeout:   30 * time.Minute,
			MaxTTL:        8 * time.Hour,
			ReapInterval:  30 * time.Second,
			FlushInterval: 30 * time.Second,
		},
		Storage:  storage.DefaultConfig(),
		Database: db.DefaultConfig(),
		Cache:    CacheConfig{MaxSize: 20 << 30, Warm: 10},
		SSH: SSHConfig{
			PublicPort: 2222, AllowADB: true, AllowReverse: true, MaxTunnelsPerConnection: 32,
			CodeTTL: 10 * time.Minute, CertificateTTL: 15 * time.Minute, RefreshTTL: 30 * 24 * time.Hour,
			ClientDir: "/usr/share/holtdroid/connect",
		},
		ADB:     ADBConfig{Browser: true, OwnerOnly: true},
		Uploads: UploadsConfig{Enabled: true, Prefix: "uploads", MaxSize: 1 << 30, TemporaryTTL: 7 * 24 * time.Hour},
		AppData: AppDataConfig{
			Keep: 6, MaxAge: 7 * 24 * time.Hour, MaxCacheSize: 256 << 20, MaxSize: 1 << 30, Export: true, Timeout: 5 * time.Minute,
		},
		Sources: []source.Config{{
			Name:       "local",
			Type:       "filesystem",
			Filesystem: storage.FilesystemConfig{Dir: "/var/lib/holtdroid/apks"},
		}},
	}
}

var sourceName = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,62}$`)

// UploadSource is the source uploads go to: uploads.source or the first one.
func (c Config) UploadSource() string {
	if !c.Uploads.Enabled {
		return ""
	}
	if c.Uploads.Source != "" {
		return c.Uploads.Source
	}
	if len(c.Sources) > 0 {
		return c.Sources[0].Name
	}
	return ""
}

func (c Config) Validate() error {
	var errs []error
	if c.InternalURL == "" {
		errs = append(errs, errors.New("internalURL is required"))
	}
	if c.Sessions.IdleTimeout <= 0 || c.Sessions.MaxTTL <= 0 || c.Sessions.ReapInterval <= 0 || c.Sessions.FlushInterval <= 0 {
		errs = append(errs, errors.New("sessions durations must be positive"))
	}
	if c.SSH.Enabled {
		if u, err := url.Parse(c.SSH.GatewayURL); err != nil || u.Host == "" {
			errs = append(errs, errors.New("ssh.gatewayURL must be an absolute URL"))
		}
		if c.SSH.PublicPort < 1 || c.SSH.PublicPort > 65535 {
			errs = append(errs, errors.New("ssh.publicPort must be a TCP port"))
		}
		if c.SSH.CodeTTL <= 0 || c.SSH.CertificateTTL <= 0 || c.SSH.RefreshTTL <= 0 {
			errs = append(errs, errors.New("ssh.codeTTL, ssh.certificateTTL and ssh.refreshTTL must be positive"))
		}
	}
	sources := map[string]source.Config{}
	for _, sc := range c.Sources {
		if !sourceName.MatchString(sc.Name) {
			errs = append(errs, fmt.Errorf("source name %q must be lowercase letters, digits, - or _", sc.Name))
		}
		if _, dup := sources[sc.Name]; dup {
			errs = append(errs, fmt.Errorf("duplicate source name %q", sc.Name))
		}
		sources[sc.Name] = sc
		if sc.PollInterval < 0 {
			errs = append(errs, fmt.Errorf("source %q: pollInterval must not be negative", sc.Name))
		}
		if _, err := rules.Parse(sc.Include); err != nil {
			errs = append(errs, fmt.Errorf("source %q: include: %w", sc.Name, err))
		}
	}
	if c.Uploads.Enabled {
		up, ok := sources[c.UploadSource()]
		switch {
		case !ok:
			errs = append(errs, fmt.Errorf("uploads.source %q is not a configured source", c.UploadSource()))
		case up.ReadOnly:
			errs = append(errs, fmt.Errorf("uploads.source %q is read-only", up.Name))
		case len(up.Include) > 0:
			errs = append(errs, fmt.Errorf("uploads.source %q has include rules; uploads could land outside them", up.Name))
		}
		if c.Uploads.MaxSize == 0 {
			errs = append(errs, errors.New("uploads.maxSize must be positive"))
		}
		if c.Uploads.TemporaryTTL <= 0 {
			errs = append(errs, errors.New("uploads.temporaryTTL must be positive"))
		}
	}
	if c.AppData.Enabled {
		if c.AppData.Keep < 0 || c.AppData.MaxAge < 0 {
			errs = append(errs, errors.New("appData.keep and appData.maxAge must not be negative"))
		}
		if c.AppData.Timeout <= 0 {
			errs = append(errs, errors.New("appData.timeout must be positive"))
		}
	}
	seen := map[string]bool{}
	for _, e := range c.Providers {
		if e.Name == "" || e.URL == "" {
			errs = append(errs, fmt.Errorf("provider %q needs name and url", e.Name))
		}
		if seen[e.Name] {
			errs = append(errs, fmt.Errorf("duplicate provider name %q", e.Name))
		}
		if e.Name+"-" == contract.HandlePrefix {
			errs = append(errs, errors.New(`provider name "user" is reserved for SSH`))
		}
		seen[e.Name] = true
	}
	return errors.Join(errs...)
}
