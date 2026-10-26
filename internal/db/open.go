// Package db is the api's SQL database: goose migrations and sqlc queries on
// top of database/sql.
package db

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/benbjohnson/litestream"
	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"

	"github.com/holtdroid/holtdroid/internal/secrets"
	"github.com/holtdroid/holtdroid/internal/storage"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Config struct {
	Type    string
	Path    string
	Replica storage.Config
}

func DefaultConfig() Config {
	return Config{Type: "memory", Path: "/var/lib/holtdroid/holtdroid.db"}
}

type DB struct {
	*Queries
	sql     *sql.DB
	store   *litestream.Store
	replica *litestream.DB
}

func Open(ctx context.Context, cfg Config, reg *secrets.Registry) (*DB, error) {
	switch cfg.Type {
	case "memory", "":
		if cfg.Replica.Type != "" {
			return nil, errors.New("database: replica needs type sqlite")
		}
		sqlDB, err := open(ctx, ":memory:?_pragma=foreign_keys(1)")
		if err != nil {
			return nil, err
		}
		// Every connection to :memory: is a separate database.
		sqlDB.SetMaxOpenConns(1)
		return &DB{Queries: New(sqlDB), sql: sqlDB}, nil
	case "sqlite":
		return openFile(ctx, cfg, reg)
	default:
		return nil, fmt.Errorf("database: unknown type %q", cfg.Type)
	}
}

func openFile(ctx context.Context, cfg Config, reg *secrets.Registry) (*DB, error) {
	if cfg.Path == "" {
		return nil, errors.New("database: path is required for type sqlite")
	}
	if reg == nil {
		reg = secrets.NewRegistry()
	}
	client, err := newReplicaClient(ctx, cfg.Replica, reg)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(cfg.Path), 0o700); err != nil {
		return nil, fmt.Errorf("database: %w", err)
	}
	if client != nil {
		if err := restore(ctx, client, cfg.Path); err != nil {
			return nil, err
		}
	}
	sqlDB, err := open(ctx, "file:"+cfg.Path+
		"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(wal)&_pragma=synchronous(normal)&_txlock=immediate")
	if err != nil {
		return nil, err
	}
	d := &DB{Queries: New(sqlDB), sql: sqlDB}
	if client == nil {
		return d, nil
	}
	d.replica = litestream.NewDB(cfg.Path)
	d.replica.Replica = litestream.NewReplicaWithClient(d.replica, client)
	d.store = litestream.NewStore([]*litestream.DB{d.replica}, litestream.DefaultCompactionLevels)
	d.store.Logger = slog.Default().With("component", "litestream")
	if err := d.store.Open(ctx); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("database: replica: %w", err)
	}
	// Litestream holds a read transaction from its first sync on; until then
	// closing the api's last connection would checkpoint away WAL frames it
	// never saw.
	if err := d.replica.Sync(ctx); err != nil {
		_ = d.Close()
		return nil, fmt.Errorf("database: replica: %w", err)
	}
	return d, nil
}

func restore(ctx context.Context, client litestream.ReplicaClient, path string) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("database: %w", err)
	}
	if err := client.Init(ctx); err != nil {
		return fmt.Errorf("database: replica: %w", err)
	}
	opt := litestream.NewRestoreOptions()
	opt.OutputPath = path
	err := litestream.NewReplicaWithClient(nil, client).Restore(ctx, opt)
	if errors.Is(err, litestream.ErrTxNotAvailable) || errors.Is(err, litestream.ErrNoSnapshots) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("database: restore: %w", err)
	}
	return nil
}

func open(ctx context.Context, dsn string) (*sql.DB, error) {
	sqlDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	if err := migrate(ctx, sqlDB); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}
	return sqlDB, nil
}

func migrate(ctx context.Context, sqlDB *sql.DB) error {
	dir, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return err
	}
	p, err := goose.NewProvider(goose.DialectSQLite3, sqlDB, dir)
	if err != nil {
		return err
	}
	if _, err := p.Up(ctx); err != nil {
		return fmt.Errorf("database: migrate: %w", err)
	}
	return nil
}

// Close closes the database and, with a replica, uploads what is left of
// the WAL before returning.
func (d *DB) Close() error {
	if d.store == nil {
		return d.sql.Close()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	err := d.replica.Sync(ctx)
	err = errors.Join(err, d.sql.Close())
	return errors.Join(err, d.store.Close(ctx))
}
