// Package db is the api's SQL database: goose migrations and sqlc queries on
// top of database/sql.
package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Config struct {
	Type string
}

func DefaultConfig() Config {
	return Config{Type: "memory"}
}

type DB struct {
	*Queries
	sql *sql.DB
}

func Open(ctx context.Context, cfg Config) (*DB, error) {
	switch cfg.Type {
	case "memory", "":
	default:
		return nil, fmt.Errorf("database: unknown type %q", cfg.Type)
	}
	sqlDB, err := sql.Open("sqlite", ":memory:?_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	// Every connection to :memory: is a separate database.
	sqlDB.SetMaxOpenConns(1)
	if err := migrate(ctx, sqlDB); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}
	return &DB{Queries: New(sqlDB), sql: sqlDB}, nil
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

func (d *DB) Close() error { return d.sql.Close() }
