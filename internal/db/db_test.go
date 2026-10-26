package db

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/johannesboyne/gofakes3"
	"github.com/johannesboyne/gofakes3/backend/s3mem"

	"github.com/holtdroid/holtdroid/internal/secrets"
	"github.com/holtdroid/holtdroid/internal/storage"
)

func TestOpen(t *testing.T) {
	dir := t.TempDir()
	for _, tc := range []struct {
		name    string
		cfg     Config
		wantErr bool
	}{
		{name: "memory", cfg: Config{Type: "memory"}},
		{name: "default", cfg: Config{}},
		{name: "sqlite", cfg: Config{Type: "sqlite", Path: filepath.Join(dir, "nested", "a.db")}},
		{name: "sqlite without path", cfg: Config{Type: "sqlite"}, wantErr: true},
		{name: "memory with replica", cfg: Config{Type: "memory", Replica: storage.Config{Type: "filesystem", Filesystem: storage.FilesystemConfig{Dir: dir}}}, wantErr: true},
		{name: "unknown replica", cfg: Config{Type: "sqlite", Path: filepath.Join(dir, "b.db"), Replica: storage.Config{Type: "gcs"}}, wantErr: true},
		{name: "s3 replica without bucket", cfg: Config{Type: "sqlite", Path: filepath.Join(dir, "c.db"), Replica: storage.Config{Type: "s3"}}, wantErr: true},
		{name: "postgres", cfg: Config{Type: "postgres"}, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d, err := Open(context.Background(), tc.cfg, nil)
			if tc.wantErr {
				if err == nil {
					_ = d.Close()
					t.Fatal("expected an error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := d.Close(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSessionEvents(t *testing.T) {
	ctx := context.Background()
	d := mustOpen(t, DefaultConfig())

	at := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	for i, action := range []string{"session.launch", "session.stop"} {
		if err := d.AddSessionEvent(ctx, AddSessionEventParams{
			At: at.Add(time.Duration(i) * time.Minute), Provider: "fake", SessionID: "s1", Action: action, Result: "ok", Actor: "otter", Artifact: "local/hello.apk",
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := d.AddSessionEvent(ctx, AddSessionEventParams{At: at, Provider: "fake", SessionID: "s2", Action: "session.launch", Result: "ok"}); err != nil {
		t.Fatal(err)
	}

	events, err := d.ListSessionEvents(ctx, ListSessionEventsParams{Provider: "fake", SessionID: "s1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Action != "session.launch" || events[1].Action != "session.stop" || !events[1].At.Equal(at.Add(time.Minute)) {
		t.Fatalf("events = %+v", events)
	}

	fresh := mustOpen(t, DefaultConfig())
	if events, _ := fresh.ListSessionEvents(ctx, ListSessionEventsParams{Provider: "fake", SessionID: "s1"}); len(events) != 0 {
		t.Fatalf("in-memory databases must not share data: %+v", events)
	}
}

func TestPersistence(t *testing.T) {
	backend := s3mem.New()
	if err := backend.CreateBucket("holtdroid"); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(gofakes3.New(backend).Server())
	t.Cleanup(srv.Close)
	t.Setenv("DB_TEST_ACCESS_KEY", "key")
	t.Setenv("DB_TEST_SECRET_KEY", "secret")

	for _, tc := range []struct {
		name    string
		replica storage.Config
		durable bool
	}{
		{name: "file only"},
		{name: "filesystem replica", replica: storage.Config{Type: "filesystem", Filesystem: storage.FilesystemConfig{Dir: filepath.Join(t.TempDir(), "replica")}}, durable: true},
		{name: "s3 replica", replica: storage.Config{Type: "s3", S3: storage.S3Config{
			Endpoint: srv.URL, Region: "us-east-1", Bucket: "holtdroid", Prefix: "db/", PathStyle: true,
			AccessKey: secrets.Ref("env:DB_TEST_ACCESS_KEY"), SecretKey: secrets.Ref("env:DB_TEST_SECRET_KEY"),
		}}, durable: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			cfg := Config{Type: "sqlite", Path: filepath.Join(t.TempDir(), "holtdroid.db"), Replica: tc.replica}
			params := ListSessionEventsParams{Provider: "fake", SessionID: "s1"}

			d, err := Open(ctx, cfg, nil)
			if err != nil {
				t.Fatal(err)
			}
			if err := d.AddSessionEvent(ctx, AddSessionEventParams{At: time.Now(), Provider: "fake", SessionID: "s1", Action: "session.launch", Result: "ok"}); err != nil {
				t.Fatal(err)
			}
			if err := d.Close(); err != nil {
				t.Fatal(err)
			}

			reopened := mustOpen(t, cfg)
			if events, err := reopened.ListSessionEvents(ctx, params); err != nil || len(events) != 1 {
				t.Fatalf("after reopen: events = %+v, err = %v", events, err)
			}
			if err := reopened.Close(); err != nil {
				t.Fatal(err)
			}

			for _, suffix := range []string{"", "-wal", "-shm"} {
				if err := os.Remove(cfg.Path + suffix); err != nil && !os.IsNotExist(err) {
					t.Fatal(err)
				}
			}
			_ = os.RemoveAll(filepath.Join(filepath.Dir(cfg.Path), ".holtdroid.db-litestream"))
			restored := mustOpen(t, cfg)
			events, err := restored.ListSessionEvents(ctx, params)
			if err != nil {
				t.Fatal(err)
			}
			if want := map[bool]int{true: 1, false: 0}[tc.durable]; len(events) != want {
				t.Fatalf("after losing the file: %d events, want %d", len(events), want)
			}
		})
	}
}

func mustOpen(t *testing.T, cfg Config) *DB {
	t.Helper()
	d, err := Open(context.Background(), cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
}
