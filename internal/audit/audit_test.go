package audit

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kriakiku/holtdroid/internal/secrets"
)

func TestEmit(t *testing.T) {
	var buf bytes.Buffer
	at := time.Date(2026, 1, 1, 12, 0, 0, 0, time.FixedZone("x", 3600))
	l, err := New(context.Background(), Config{}, "api", "test", nil, WithStdout(&buf), WithClock(func() time.Time { return at }))
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.1")
	r.Header.Set("User-Agent", "curl/8")
	ctx := WithClient(context.Background(), ClientFromRequest(r))
	l.Emit(ctx, Event{Action: SessionStop, Actor: "otter", Details: map[string]string{"empty": "", "b": "2", "a": "1"}})

	want := `{"time":"2026-01-01T11:00:00Z","level":"INFO","msg":"audit","log":"audit","schema":1,"service":"api","action":"session.stop","result":"ok","actor":"otter","clientIp":"192.0.2.1","forwardedFor":"203.0.113.7, 10.0.0.1","userAgent":"curl/8","details":{"a":"1","b":"2"}}` + "\n"
	if buf.String() != want {
		t.Fatalf("got  %s\nwant %s", buf.String(), want)
	}

	var nilLogger *Logger
	nilLogger.Emit(ctx, Event{Action: SignIn})
	if err := nilLogger.Close(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestWebhook(t *testing.T) {
	var (
		mu      sync.Mutex
		batches [][]Event
		calls   int
		auth    []string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		auth = append(auth, r.Header.Get("Authorization"))
		if calls == 1 {
			http.Error(w, "busy", http.StatusServiceUnavailable)
			return
		}
		var batch []Event
		if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
			t.Error(err)
		}
		batches = append(batches, batch)
	}))
	defer srv.Close()
	t.Setenv("HOOK_URL", srv.URL+"/audit?token=hush")
	t.Setenv("HOOK_AUTH", "Bearer abc")

	cfg := DefaultConfig().Webhook
	cfg.URL, cfg.Authorization, cfg.BatchSize, cfg.FlushInterval = "env:HOOK_URL", "env:HOOK_AUTH", 2, time.Hour
	s, err := newWebhookSink(context.Background(), cfg, secrets.NewRegistry())
	if err != nil {
		t.Fatal(err)
	}
	s.sleep = func(context.Context, time.Duration) bool { return true }
	for _, a := range []Action{SignIn, SessionLaunch, SignOut} {
		s.Write(context.Background(), Event{Action: a})
	}
	if err := s.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	mu.Lock()
	defer mu.Unlock()
	if calls != 3 || len(batches) != 2 || len(batches[0]) != 2 || batches[1][0].Action != SignOut {
		t.Fatalf("calls %d, batches %+v", calls, batches)
	}
	if auth[0] != "Bearer abc" {
		t.Fatalf("authorization %q", auth[0])
	}
}

func TestWebhookGivesUpWithoutLeakingTheURL(t *testing.T) {
	t.Setenv("HOOK_URL", "http://127.0.0.1:1/audit?token=hush")
	cfg := DefaultConfig().Webhook
	cfg.URL, cfg.Retries = "env:HOOK_URL", 1
	s, err := newWebhookSink(context.Background(), cfg, secrets.NewRegistry())
	if err != nil {
		t.Fatal(err)
	}
	err = s.send(context.Background(), nil)
	if err == nil || strings.Contains(err.Error(), "hush") {
		t.Fatalf("err = %v", err)
	}
	_ = s.Close(context.Background())
}

func TestValidate(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Webhook.URL = "env:X"
	cfg.Webhook.BatchSize = 0
	if err := cfg.Validate(); err == nil {
		t.Fatal("batchSize 0 accepted")
	}
	if _, err := New(context.Background(), Config{Webhook: WebhookConfig{URL: "env:MISSING_HOOK"}}, "api", "", secrets.NewRegistry()); err == nil {
		t.Fatal("invalid webhook config accepted")
	}
	if err := DefaultConfig().Validate(); err != nil {
		t.Fatal(err)
	}
}
