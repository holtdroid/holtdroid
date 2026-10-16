package api

import (
	"errors"
	"fmt"
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

type Config struct {
	Listen         string
	InternalListen string
	PublicURL      string
	InternalURL    string
	Auth           auth.Config
	Sessions       SessionsConfig
	Storage        storage.Config
	Cache          CacheConfig
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
