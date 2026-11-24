package api

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/provider/fake"
)

func TestSessionStats(t *testing.T) {
	h := newHarness(t, 4, func(c *fake.Config) { c.StepDelay = time.Millisecond })
	start := h.clock.Now()

	stopped := h.create("otter")
	h.waitReady(stopped.ID)
	h.expect(http.StatusOK, http.MethodPost, "/api/v1/sessions/fake/"+stopped.ID+"/extend", "otter", "", nil)
	h.clock.Advance(10 * time.Minute)
	h.expect(http.StatusNoContent, http.MethodDelete, "/api/v1/sessions/fake/"+stopped.ID, "root", "admins", nil)

	idle := h.create("beaver")
	h.clock.Advance(31 * time.Minute)
	h.srv.Reap(context.Background())
	running := h.create("otter")

	const path = "/api/v1/admin/stats/sessions"
	h.expect(http.StatusForbidden, http.MethodGet, path+"?since=2026-01-01T00:00:00Z", "otter", "", nil)
	h.expect(http.StatusUnprocessableEntity, http.MethodGet, path, "root", "admins", nil)
	h.expect(http.StatusUnprocessableEntity, http.MethodGet, path+"?since=2024-01-01T00:00:00Z", "root", "admins", nil)
	h.expect(http.StatusUnprocessableEntity, http.MethodGet, path+"?since=2027-01-01T00:00:00Z", "root", "admins", nil)

	stats := decode[SessionStats](t, h.do(http.MethodGet, path+"?since=2026-01-01T00:00:00Z", "root", "admins", nil))
	if len(stats.Items) != 3 || stats.Truncated || !stats.Until.Equal(h.clock.Now()) {
		t.Fatalf("stats = %+v", stats)
	}
	got := map[string]StatsSession{}
	for _, it := range stats.Items {
		got[it.ID] = it
	}
	if s := got[stopped.ID]; s.Actor != "otter" || s.Ended != "stopped" || s.Extended != 1 || s.End == nil ||
		s.End.Sub(s.Start) != 10*time.Minute || s.Package != "com.example.helloworld" || s.Artifact == "" {
		t.Fatalf("stopped = %+v", s)
	}
	if s := got[idle.ID]; s.Actor != "beaver" || s.Ended != "idle" || s.End == nil || !s.Start.Equal(start.Add(10*time.Minute)) {
		t.Fatalf("idle = %+v", s)
	}
	if s := got[running.ID]; s.End != nil || s.Ended != "" {
		t.Fatalf("running = %+v", s)
	}

	before := decode[SessionStats](t, h.do(http.MethodGet, path+"?since=2026-01-01T00:00:00Z&until="+start.Add(time.Minute).Format(time.RFC3339), "root", "admins", nil))
	if len(before.Items) != 1 || before.Items[0].ID != stopped.ID || before.Items[0].End == nil {
		t.Fatalf("until = %+v", before.Items)
	}
}
