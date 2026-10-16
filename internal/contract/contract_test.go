package contract_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/provider/fake"
	"github.com/kriakiku/holtdroid/internal/source/dir"
)

func serve(t *testing.T, register func(huma.API)) string {
	t.Helper()
	mux := http.NewServeMux()
	register(humago.New(mux, huma.DefaultConfig("test", "v1")))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestSourceRoundTrip(t *testing.T) {
	root := t.TempDir()
	for i, name := range []string{"a.apk", "b.apk", "c.apk", "notes.txt"} {
		path := filepath.Join(root, name)
		if err := os.WriteFile(path, []byte(name), 0o600); err != nil {
			t.Fatal(err)
		}
		mtime := time.Date(2026, 1, 1, i, 0, 0, 0, time.UTC)
		if err := os.Chtimes(path, mtime, mtime); err != nil {
			t.Fatal(err)
		}
	}
	url := serve(t, func(api huma.API) { contract.RegisterSource(api, dir.New(root)) })
	c := contract.NewSourceClient(url, nil)
	ctx := context.Background()

	page, err := c.List(ctx, "", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 || page.Items[0].ID != "c.apk" || page.NextCursor == "" {
		t.Fatalf("first page %+v", page)
	}
	page, err = c.List(ctx, page.NextCursor, 2)
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != "a.apk" || page.NextCursor != "" {
		t.Fatalf("second page %+v, %v", page, err)
	}

	rc, size, err := c.Open(ctx, "b.apk")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(rc)
	_ = rc.Close()
	if string(raw) != "b.apk" || size != 5 {
		t.Fatalf("download %q (%d)", raw, size)
	}

	if _, err := c.Get(ctx, "notes.txt"); !errors.Is(err, contract.ErrNotFound) {
		t.Fatalf("non-apk get: %v", err)
	}
	if _, _, err := c.Open(ctx, "../etc/passwd"); !errors.Is(err, contract.ErrNotFound) {
		t.Fatalf("traversal: %v", err)
	}
	if err := c.Health(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestProviderRoundTrip(t *testing.T) {
	p := fake.New(fake.Config{Slots: 1, StepDelay: time.Hour, PublicURL: "http://agents"})
	c := contract.NewProviderClient(serve(t, func(api huma.API) { contract.RegisterProvider(api, p) }), nil)
	ctx := context.Background()

	caps, err := c.Capabilities(ctx)
	if err != nil || caps.Display != contract.DisplayNoVNC || len(caps.Locations) == 0 {
		t.Fatalf("capabilities %+v, %v", caps, err)
	}

	s, err := c.Create(ctx, contract.CreateSession{ArtifactURL: "http://api/x", ArtifactRef: "src/x", Package: "com.x", Owner: "otter", Location: "pl"})
	if err != nil || s.State != contract.StateProvisioning || s.AgentURL != "http://agents/agents/"+s.ID {
		t.Fatalf("create %+v, %v", s, err)
	}
	if _, err := c.Create(ctx, contract.CreateSession{ArtifactURL: "http://api/x", ArtifactRef: "src/x", Package: "com.x", Owner: "otter"}); !errors.Is(err, contract.ErrNoCapacity) {
		t.Fatalf("second create: %v", err)
	}
	if _, err := c.Create(ctx, contract.CreateSession{ArtifactRef: "src/x", Package: "com.x", Owner: "otter"}); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("invalid create: %v", err)
	}

	capacity, err := c.Capacity(ctx)
	if err != nil || capacity.Free() != 0 {
		t.Fatalf("capacity %+v, %v", capacity, err)
	}

	at := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	if err := c.Touch(ctx, s.ID, at); err != nil {
		t.Fatal(err)
	}
	got, err := c.Get(ctx, s.ID)
	if err != nil || !got.LastActivity.Equal(at) {
		t.Fatalf("after touch %+v, %v", got, err)
	}

	list, err := c.List(ctx)
	if err != nil || len(list) != 1 {
		t.Fatalf("list %+v, %v", list, err)
	}
	if err := c.Delete(ctx, s.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Get(ctx, s.ID); !errors.Is(err, contract.ErrNotFound) {
		t.Fatalf("get after delete: %v", err)
	}
}
