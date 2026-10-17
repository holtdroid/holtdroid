package api

import (
	"context"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/kriakiku/holtdroid/internal/contract"
)

var (
	sessionsGauge = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "holtdroid_sessions",
		Help: "Sessions by provider and state, as of the last reaper pass.",
	}, []string{"provider", "state"})
	slotsGauge = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "holtdroid_slots",
		Help: "Device slots by provider: total and free.",
	}, []string{"provider", "kind"})
	launchesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "holtdroid_session_launches_total",
		Help: "Session launch requests by provider and result.",
	}, []string{"provider", "result"})
	launchDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "holtdroid_session_launch_duration_seconds",
		Help:    "Time from launching a session to it being ready, for sessions launched by this replica.",
		Buckets: []float64{10, 20, 30, 45, 60, 90, 120, 180, 300, 600},
	}, []string{"provider"})
	sessionsFailed = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "holtdroid_sessions_failed_total",
		Help: "Sessions launched by this replica that failed before becoming ready.",
	}, []string{"provider"})
	sessionsEnded = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "holtdroid_sessions_ended_total",
		Help: "Sessions stopped by users or reaped, by reason.",
	}, []string{"provider", "reason"})
	cacheRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "holtdroid_apk_cache_requests_total",
		Help: "APK cache lookups by result (hit or miss).",
	}, []string{"result"})
	proxyConnections = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "holtdroid_session_proxy_connections",
		Help: "Requests and WebSockets open through the session proxy.",
	}, []string{"provider"})
)

// launches remembers sessions this replica launched until they are ready or
// failed, to measure how long launching takes.
type launches struct {
	mu sync.Mutex
	m  map[sessionKey]time.Time
}

func newLaunches() *launches { return &launches{m: map[sessionKey]time.Time{}} }

func (l *launches) add(key sessionKey, at time.Time) {
	l.mu.Lock()
	l.m[key] = at
	l.mu.Unlock()
}

func (l *launches) observe(provider string, sess contract.Session, now time.Time) {
	if sess.State != contract.StateReady && sess.State != contract.StateFailed {
		return
	}
	key := sessionKey{provider, sess.ID}
	l.mu.Lock()
	at, ok := l.m[key]
	delete(l.m, key)
	l.mu.Unlock()
	switch {
	case !ok:
	case sess.State == contract.StateReady:
		launchDuration.WithLabelValues(provider).Observe(now.Sub(at).Seconds())
	default:
		sessionsFailed.WithLabelValues(provider).Inc()
	}
}

func (l *launches) retain(alive map[sessionKey]bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for k := range l.m {
		if !alive[k] {
			delete(l.m, k)
		}
	}
}

func (s *Server) observeSessions(ctx context.Context, all map[string][]contract.Session) {
	for provider, items := range all {
		counts := map[contract.SessionState]int{}
		for _, sess := range items {
			counts[sess.State]++
		}
		for _, state := range []contract.SessionState{
			contract.StateProvisioning, contract.StateBooting, contract.StateInstalling, contract.StateInstrumenting,
			contract.StateReady, contract.StateStopping, contract.StateFailed,
		} {
			sessionsGauge.WithLabelValues(provider, string(state)).Set(float64(counts[state]))
		}
		if c, err := s.providers[provider].Capacity(ctx); err == nil {
			slotsGauge.WithLabelValues(provider, "total").Set(float64(len(c.Slots)))
			slotsGauge.WithLabelValues(provider, "free").Set(float64(c.Free()))
		}
	}
}
