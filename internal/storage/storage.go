// Package storage is a minimal object store used for artifact sources and the
// APK cache, backed by a local directory or an S3-compatible bucket.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/kriakiku/holtdroid/internal/secrets"
)

var ErrNotExist = errors.New("object does not exist")

type Object struct {
	Key      string
	Size     int64
	Modified time.Time
	ETag     string
}

type Store interface {
	Get(ctx context.Context, key string) (io.ReadCloser, int64, error)
	Stat(ctx context.Context, key string) (Object, error)
	Put(ctx context.Context, key string, r io.Reader, size int64) error
	Delete(ctx context.Context, key string) error
	List(ctx context.Context, prefix string) ([]Object, error)
	// Touch marks an object as recently used, when the backend supports it.
	Touch(ctx context.Context, key string) error
}

type Config struct {
	Type       string
	Filesystem FilesystemConfig
	S3         S3Config
}

type FilesystemConfig struct {
	Dir string
}

type S3Config struct {
	Endpoint  string
	Region    string
	Bucket    string
	Prefix    string
	AccessKey secrets.Ref
	SecretKey secrets.Ref
	PathStyle bool
}

func DefaultConfig() Config {
	return Config{Type: "filesystem", Filesystem: FilesystemConfig{Dir: "/var/cache/holtdroid"}}
}

func New(ctx context.Context, cfg Config, reg *secrets.Registry) (Store, error) {
	switch cfg.Type {
	case "filesystem", "":
		return NewFilesystem(cfg.Filesystem.Dir)
	case "s3":
		return NewS3(ctx, cfg.S3, reg)
	default:
		return nil, fmt.Errorf("storage: unknown type %q", cfg.Type)
	}
}
