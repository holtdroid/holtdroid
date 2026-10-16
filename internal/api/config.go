package api

import (
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/config"
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

type SSHConfig struct {
	Enabled         bool
	GatewayURL      string
	PublicHost      string
	PublicPort      int
	AllowADB        bool
	AllowReverse    bool
	ClientIsolation bool
}

type Config struct {
	Listen         string
	InternalListen string
	PublicURL      string
	InternalURL    string
	Auth           auth.Config
	Sessions       SessionsConfig
	Storage        storage.Config
	Cache          CacheConfig
	SSH            SSHConfig
	Sources        []Endpoint
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
		Storage: storage.DefaultConfig(),
		Cache:   CacheConfig{MaxSize: 20 << 30, Warm: 10},
		SSH:     SSHConfig{PublicPort: 2222, AllowADB: true, AllowReverse: true},
	}
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
	}
	seen := map[string]bool{}
	for _, e := range append(append([]Endpoint{}, c.Sources...), c.Providers...) {
		if e.Name == "" || e.URL == "" {
			errs = append(errs, fmt.Errorf("source/provider %q needs name and url", e.Name))
		}
		if seen[e.Name] {
			errs = append(errs, fmt.Errorf("duplicate source/provider name %q", e.Name))
		}
		seen[e.Name] = true
	}
	return errors.Join(errs...)
}
