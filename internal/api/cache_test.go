package api

import (
	"context"
	"io"
	"os"
	"path"
	"testing"

	"github.com/holtdroid/holtdroid/internal/apk"
	src "github.com/holtdroid/holtdroid/internal/source"
	"github.com/holtdroid/holtdroid/internal/storage"
)

func TestCacheKeepsMetadataWithoutAPK(t *testing.T) {
	store, err := storage.NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	open := func(_ context.Context, _, _ string) (io.ReadCloser, error) {
		return os.Open("../apk/testdata/helloworld.apk")
	}
	c := NewCache(store, 0, open, func(context.Context, string, string) (io.ReadCloser, error) {
		return nil, storage.ErrNotExist
	})
	a := src.Artifact{ID: "hello.apk", Revision: "r1"}
	key := cacheKey("local", a.ID, a.Revision)
	ctx := t.Context()

	if err := c.Index(ctx, "local", a); err != nil {
		t.Fatal(err)
	}
	if _, ok := c.Lookup(ctx, "local", a.ID, a.Revision); !ok {
		t.Fatal("indexed entry not found")
	}
	if _, err := store.Stat(ctx, path.Join(key, apkObject)); err == nil {
		t.Fatal("Index stored the APK")
	}

	if _, err := c.Ensure(ctx, "local", a); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Stat(ctx, path.Join(key, apkObject)); err != nil {
		t.Fatalf("Ensure did not store the APK: %v", err)
	}

	c.maxSize = 1
	c.evict(ctx)
	if _, err := store.Stat(ctx, path.Join(key, apkObject)); err == nil {
		t.Fatal("APK not evicted")
	}
	fresh := NewCache(store, 0, open, nil)
	if e, ok := fresh.Lookup(ctx, "local", a.ID, a.Revision); !ok || e.Parser != apk.ParserVersion {
		t.Fatalf("metadata lost after eviction: %+v %v", e, ok)
	}
}

func TestCacheMetadataOutlivesTheCacheVolume(t *testing.T) {
	meta, err := storage.NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	volume := func() storage.Store {
		s, err := storage.NewFilesystem(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	downloads := 0
	open := func(_ context.Context, _, _ string) (io.ReadCloser, error) {
		downloads++
		return os.Open("../apk/testdata/helloworld.apk")
	}
	noIcon := func(context.Context, string, string) (io.ReadCloser, error) { return nil, storage.ErrNotExist }
	a := src.Artifact{ID: "hello.apk", Revision: "r1"}
	key := cacheKey("local", a.ID, a.Revision)
	ctx := t.Context()

	first := volume()
	if _, err := NewCache(first, 0, open, noIcon).WithMetadata(meta).Ensure(ctx, "local", a); err != nil {
		t.Fatal(err)
	}
	if _, err := first.Stat(ctx, path.Join(key, apkObject)); err != nil {
		t.Fatal("the APK isn't on the cache volume")
	}
	if _, err := first.Stat(ctx, path.Join(key, metaObject)); err == nil {
		t.Fatal("metadata went to the cache volume")
	}

	restarted := NewCache(volume(), 0, open, noIcon).WithMetadata(meta)
	before := downloads
	if err := restarted.Index(ctx, "local", a); err != nil {
		t.Fatal(err)
	}
	if e, ok := restarted.Lookup(ctx, "local", a.ID, a.Revision); !ok || e.Meta.Package == "" || downloads != before {
		t.Fatalf("after a restart: %+v, found %v, %d downloads", e, ok, downloads-before)
	}
	if _, err := restarted.Ensure(ctx, "local", a); err != nil || downloads != before+1 {
		t.Fatalf("Ensure after a restart: %v, %d downloads", err, downloads-before)
	}
}
