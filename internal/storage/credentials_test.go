package storage

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/johannesboyne/gofakes3"
	"github.com/johannesboyne/gofakes3/backend/s3mem"

	"github.com/kriakiku/holtdroid/internal/secrets"
)

func TestBrokerCredentials(t *testing.T) {
	backend := s3mem.New()
	if err := backend.CreateBucket("apks"); err != nil {
		t.Fatal(err)
	}
	s3srv := httptest.NewServer(gofakes3.New(backend).Server())
	t.Cleanup(s3srv.Close)

	var calls atomic.Int32
	var down atomic.Bool
	broker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "broker-token" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if down.Load() {
			http.Error(w, "login required", http.StatusServiceUnavailable)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"AccessKeyId": "ASIA", "SecretAccessKey": "secret", "Token": "session",
			"Expiration": time.Now().Add(-time.Second).UTC().Format(time.RFC3339),
		})
	}))
	t.Cleanup(broker.Close)

	t.Setenv("TEST_BROKER_TOKEN", "broker-token")
	ctx := context.Background()
	store, err := New(ctx, Config{Type: "s3", S3: S3Config{
		Endpoint: s3srv.URL, Bucket: "apks", Region: "us-east-1", PathStyle: true,
		CredentialsURL: broker.URL, CredentialsToken: "env:TEST_BROKER_TOKEN",
	}}, secrets.NewRegistry())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Put(ctx, "a.apk", strings.NewReader("x"), 1); err != nil {
		t.Fatal(err)
	}
	if _, err := store.List(ctx, ""); err != nil {
		t.Fatal(err)
	}
	if calls.Load() < 2 {
		t.Fatalf("expired credentials must be fetched again, broker called %d times", calls.Load())
	}

	down.Store(true)
	if _, err := store.List(ctx, ""); err == nil || !strings.Contains(err.Error(), "503") {
		t.Fatalf("broker without a session: %v", err)
	}
}
