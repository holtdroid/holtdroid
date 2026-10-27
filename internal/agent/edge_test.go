package agent

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/agent/conns"
	"github.com/holtdroid/holtdroid/internal/contract"
)

func TestEdgeProber(t *testing.T) {
	var asked atomic.Int32
	cf := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked.Add(1)
		_, _ = io.WriteString(w, "fl=1\nh="+r.URL.Query().Get("host")+"\ncolo=vno\nloc=LT\n")
	}))
	defer cf.Close()

	tracker := conns.New(slog.New(slog.DiscardHandler))
	p := newEdgeProber(tracker, "")
	p.trace = func(host string) string { return cf.URL + "/cdn-cgi/trace?host=" + host }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	watch, stop := tracker.Subscribe()
	defer stop()
	go p.run(ctx)
	time.Sleep(10 * time.Millisecond)

	now := time.Now()
	tracker.Open(contract.Connection{ID: "a", Start: now, Host: "api.example.com", Address: "104.18.24.163", Port: 443, Outbound: "lv"})
	tracker.Open(contract.Connection{ID: "b", Start: now, Host: "api.example.com", Address: "104.18.24.163", Port: 443, Outbound: "lv"})
	tracker.Open(contract.Connection{ID: "origin", Start: now, Host: "s3.example.com", Address: "52.94.0.1", Port: 443, Outbound: "lv"})

	edged := map[string]string{}
	deadline := time.After(3 * time.Second)
	for len(edged) < 2 {
		select {
		case c := <-watch:
			if c.Edge != "" {
				edged[c.ID] = c.Edge
			}
		case <-deadline:
			t.Fatalf("edges %v", edged)
		}
	}
	if edged["a"] != "VNO" || edged["b"] != "VNO" {
		t.Fatalf("edges %v", edged)
	}
	if n := asked.Load(); n != 1 {
		t.Errorf("asked Cloudflare %d times for one host", n)
	}

	tracker.Open(contract.Connection{ID: "c", Start: now, Host: "api.example.com", Address: "104.18.24.163", Port: 443, Outbound: "lv"})
	tracker.Open(contract.Connection{ID: "pl", Start: now, Host: "api.example.com", Address: "104.18.24.163", Port: 443, Outbound: "pl"})
	for got := map[string]string{}; len(got) < 2; {
		select {
		case c := <-watch:
			if c.ID == "c" || c.ID == "pl" {
				got[c.ID] = c.Edge
			}
		case <-deadline:
			t.Fatal("no lines for c and pl")
		}
		if got["c"] != "" && got["c"] != "VNO" {
			t.Fatalf("a later connection got %q", got["c"])
		}
	}
	time.Sleep(50 * time.Millisecond)
	if n := asked.Load(); n != 2 {
		t.Errorf("another location should be asked again: %d", n)
	}
}
