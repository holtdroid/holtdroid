package source

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/johannesboyne/gofakes3"
	"github.com/johannesboyne/gofakes3/backend/s3mem"

	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/secrets"
	"github.com/kriakiku/holtdroid/internal/storage"
)

func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.DiscardHandler))
	os.Exit(m.Run())
}

func stores(t *testing.T) map[string]storage.Store {
	t.Helper()
	fsStore, err := storage.NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	backend := s3mem.New()
	if err := backend.CreateBucket("apks"); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(gofakes3.New(backend).Server())
	t.Cleanup(srv.Close)
	t.Setenv("TEST_S3_KEY", "key")
	t.Setenv("TEST_S3_SECRET", "secret")
	s3Store, err := storage.New(context.Background(), storage.Config{Type: "s3", S3: storage.S3Config{
		Endpoint: srv.URL, Bucket: "apks", Prefix: "builds", Region: "us-east-1",
		AccessKey: "env:TEST_S3_KEY", SecretKey: "env:TEST_S3_SECRET", PathStyle: true,
	}}, secrets.NewRegistry())
	if err != nil {
		t.Fatal(err)
	}
	return map[string]storage.Store{"filesystem": fsStore, "s3": s3Store}
}

func put(t *testing.T, s storage.Store, key, body string) {
	t.Helper()
	if err := s.Put(context.Background(), key, strings.NewReader(body), int64(len(body))); err != nil {
		t.Fatal(err)
	}
}

func TestList(t *testing.T) {
	ctx := context.Background()
	for name, store := range stores(t) {
		t.Run(name, func(t *testing.T) {
			put(t, store, "old.apk", "old")
			put(t, store, "slack/new.apk", "new")
			put(t, store, "slack/new.apk"+MetaSuffix, `{"title":"New build","changelog":"- fixed login","uploadedAt":"2030-01-01T00:00:00Z","tags":{"branch":"main"},"extra":1}`)
			put(t, store, "broken.apk", "x")
			put(t, store, "broken.apk"+MetaSuffix, `{not json`)
			put(t, store, "notes.txt", "ignored")
			put(t, store, "orphan.apk"+MetaSuffix, `{}`)

			src := New(store, false)
			list, err := src.List(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if len(list) != 3 || list[0].ID != "slack/new.apk" {
				t.Fatalf("list %+v", list)
			}
			n := list[0]
			if n.FileName != "new.apk" || n.Meta.Title != "New build" || n.Meta.Tags["branch"] != "main" || n.Revision == "" || n.MetaRevision == "" {
				t.Fatalf("new.apk %+v", n)
			}
			if !n.UploadedAt().Equal(time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)) {
				t.Fatalf("uploadedAt %v", n.UploadedAt())
			}
			for _, a := range list[1:] {
				if a.Meta.Title != "" || a.Meta.Private() {
					t.Fatalf("%s meta %+v", a.ID, a.Meta)
				}
			}

			got, err := src.Get(ctx, "slack/new.apk")
			if err != nil || got.Revision != n.Revision || got.MetaRevision != n.MetaRevision || got.Meta.Changelog != "- fixed login" {
				t.Fatalf("get %+v, %v", got, err)
			}
			for _, id := range []string{"notes.txt", "missing.apk", "slack/new.apk" + MetaSuffix} {
				if _, err := src.Get(ctx, id); !errors.Is(err, contract.ErrNotFound) {
					t.Fatalf("get %s: %v", id, err)
				}
			}

			put(t, store, "slack/new.apk", "rebuilt")
			again, err := src.Get(ctx, "slack/new.apk")
			if err != nil || again.Revision == n.Revision || again.Size != 7 {
				t.Fatalf("revision must change on overwrite: %+v, %v", again, err)
			}
		})
	}
}

func TestWrite(t *testing.T) {
	ctx := context.Background()
	for name, store := range stores(t) {
		t.Run(name, func(t *testing.T) {
			src := New(store, false)
			meta := Meta{Owner: "otter", UploadedBy: "Otter", Visibility: Private, Origin: "upload"}
			a, err := src.Put(ctx, "uploads/ab/app.apk", strings.NewReader("apk"), 3, meta)
			if err != nil {
				t.Fatal(err)
			}
			if a.FileName != "app.apk" || !a.Meta.Private() || a.Meta.Owner != "otter" {
				t.Fatalf("put %+v", a)
			}
			for _, tt := range []struct {
				user    string
				admin   bool
				visible bool
			}{{"otter", false, true}, {"beaver", false, false}, {"root", true, true}, {"", false, false}} {
				if got := a.VisibleTo(tt.user, tt.admin); got != tt.visible {
					t.Errorf("VisibleTo(%q, %v) = %v", tt.user, tt.admin, got)
				}
				if got := a.ManageableBy(tt.user, tt.admin); got != tt.visible {
					t.Errorf("ManageableBy(%q, %v) = %v", tt.user, tt.admin, got)
				}
			}

			meta.Visibility = Public
			b, err := src.SetMeta(ctx, a.ID, meta)
			if err != nil || b.Meta.Private() || b.Revision != a.Revision || b.MetaRevision == a.MetaRevision {
				t.Fatalf("set meta %+v, %v", b, err)
			}
			if _, err := src.SetMeta(ctx, "missing.apk", meta); !errors.Is(err, contract.ErrNotFound) {
				t.Fatalf("set meta on missing: %v", err)
			}

			rc, size, err := src.Open(ctx, a.ID)
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := io.ReadAll(rc)
			_ = rc.Close()
			if string(raw) != "apk" || size != 3 {
				t.Fatalf("open %q %d", raw, size)
			}

			if err := src.Delete(ctx, a.ID); err != nil {
				t.Fatal(err)
			}
			objs, err := store.List(ctx, "")
			if err != nil || len(objs) != 0 {
				t.Fatalf("leftovers %+v, %v", objs, err)
			}
			if err := src.Delete(ctx, a.ID); !errors.Is(err, contract.ErrNotFound) {
				t.Fatalf("second delete: %v", err)
			}
			if _, err := src.Put(ctx, "app.txt", strings.NewReader("x"), 1, Meta{}); !errors.Is(err, contract.ErrInvalid) {
				t.Fatalf("non-apk put: %v", err)
			}

			ro := New(store, true)
			if _, err := ro.Put(ctx, "x.apk", strings.NewReader("x"), 1, Meta{}); !errors.Is(err, ErrReadOnly) {
				t.Fatalf("read-only put: %v", err)
			}
			if err := ro.Delete(ctx, "x.apk"); !errors.Is(err, ErrReadOnly) {
				t.Fatalf("read-only delete: %v", err)
			}
		})
	}
}

func TestSkipsHiddenAndUnreadable(t *testing.T) {
	dir := t.TempDir()
	store, err := storage.NewFilesystem(dir)
	if err != nil {
		t.Fatal(err)
	}
	put(t, store, "app.apk", "x")
	put(t, store, ".trash/old.apk", "x")
	if err := os.Mkdir(dir+"/lost+found", 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir+"/lost+found", 0o700) })
	list, err := New(store, true).List(context.Background())
	if err != nil || len(list) != 1 || list[0].ID != "app.apk" {
		t.Fatalf("list %+v, %v", list, err)
	}
}
