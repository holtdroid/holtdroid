package db

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/benbjohnson/litestream"
	lsfile "github.com/benbjohnson/litestream/file"
	lss3 "github.com/benbjohnson/litestream/s3"

	"github.com/holtdroid/holtdroid/internal/secrets"
	"github.com/holtdroid/holtdroid/internal/storage"
)

func newReplicaClient(ctx context.Context, cfg storage.Config, reg *secrets.Registry) (litestream.ReplicaClient, error) {
	switch cfg.Type {
	case "":
		return nil, nil
	case "filesystem":
		if cfg.Filesystem.Dir == "" {
			return nil, errors.New("database: replica.filesystem.dir is required")
		}
		return lsfile.NewReplicaClient(cfg.Filesystem.Dir), nil
	case "s3":
		s := cfg.S3
		if s.Bucket == "" {
			return nil, errors.New("database: replica.s3.bucket is required")
		}
		if s.CredentialsURL != "" {
			return nil, errors.New("database: replica.s3.credentialsURL is not supported; use static keys or the AWS default credentials")
		}
		c := lss3.NewReplicaClient()
		c.Endpoint = s.Endpoint
		c.Region = s.Region
		c.Bucket = s.Bucket
		c.Path = strings.Trim(s.Prefix, "/")
		if c.Path == "" {
			c.Path = "database"
		}
		c.ForcePathStyle = s.PathStyle
		if !s.AccessKey.IsZero() {
			var err error
			if c.AccessKeyID, err = reg.Resolve(ctx, s.AccessKey); err != nil {
				return nil, err
			}
			if c.SecretAccessKey, err = reg.Resolve(ctx, s.SecretKey); err != nil {
				return nil, err
			}
		}
		return c, nil
	default:
		return nil, fmt.Errorf("database: unknown replica type %q", cfg.Type)
	}
}
