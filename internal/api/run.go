package api

import (
	"context"
	"errors"
	"time"

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/contract"
)

// Run drives background work until ctx is cancelled: reaping idle and expired
// sessions, flushing activity to providers, watching sources for changes and
// warming the APK cache.
func (s *Server) Run(ctx context.Context) {
	reap := time.NewTicker(s.cfg.Sessions.ReapInterval)
	flush := time.NewTicker(s.cfg.Sessions.FlushInterval)
	defer reap.Stop()
	defer flush.Stop()

	go s.warmLoop(ctx)
	go s.watchSources(ctx)
	if s.appData != nil {
		go s.appDataLoop(ctx)
	}
	if s.recordings != nil {
		go s.recordingsLoop(ctx)
	}
	if s.references != nil {
		go s.referencesLoop(ctx)
	}

	for {
		select {
		case <-ctx.Done():
			s.Flush(context.WithoutCancel(ctx))
			return
		case <-reap.C:
			s.Reap(ctx)
		case <-flush.C:
			s.Flush(ctx)
		}
	}
}

// Reap deletes sessions that were idle longer than idleTimeout or live longer
// than maxTTL.
func (s *Server) Reap(ctx context.Context) {
	all, errs := s.allSessions(ctx)
	for _, e := range errs {
		s.log.Warn("reaper could not list sessions", "provider", e.Source, "err", e.Message)
	}
	now := s.now()
	s.observeSessions(ctx, all)
	alive := map[sessionKey]bool{}
	for provider, items := range all {
		for _, sess := range items {
			key := sessionKey{provider, sess.ID}
			alive[key] = true
			s.launches.observe(provider, sess, now)
			reason, metric := "", ""
			switch {
			case now.Sub(sess.CreatedAt) > s.limits(ctx, sess.Owner).MaxSessionTTL:
				reason, metric = "max TTL reached", "ttl"
			case now.Sub(s.lastActivity(provider, sess)) > s.cfg.Sessions.IdleTimeout:
				reason, metric = "idle timeout", "idle"
			}
			if reason == "" || sess.State == contract.StateStopping {
				continue
			}
			if _, _, err := s.saveAppData(ctx, provider, sess, "reap", false); errors.Is(err, contract.ErrBusy) {
				continue
			}
			s.stopRecording(ctx, provider, sess)
			ev := audit.Event{
				Action: audit.SessionReap, Provider: provider, Session: sess.ID, Artifact: sess.ArtifactRef,
				Details: map[string]string{"owner": sess.Owner},
			}
			if err := s.providers[provider].Delete(ctx, sess.ID); err != nil {
				s.log.Warn("reaper could not delete session", "provider", provider, "session", sess.ID, "err", err)
				ev.Details["trigger"] = reason
				s.emitResult(ctx, ev, err)
				continue
			}
			s.agents.forget(key)
			sessionsEnded.WithLabelValues(provider, metric).Inc()
			ev.Reason = reason
			s.emit(ctx, ev)
			s.log.Info("session reaped", "provider", provider, "session", sess.ID, "owner", sess.Owner, "reason", reason)
		}
	}
	if len(errs) == 0 {
		s.activity.Retain(alive)
		s.launches.retain(alive)
	}
}

// Flush persists in-memory activity to providers.
func (s *Server) Flush(ctx context.Context) {
	for key, at := range s.activity.TakeDirty() {
		p, ok := s.providers[key.Provider]
		if !ok {
			continue
		}
		if err := p.Touch(ctx, key.ID, at); err != nil {
			s.activity.Restore(key)
			s.log.Debug("activity flush failed", "provider", key.Provider, "session", key.ID, "err", err)
		}
	}
}

func (s *Server) warmLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case item := <-s.warm:
			if s.cached(ctx, item.source, item.artifact) {
				continue
			}
			wctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
			var err error
			if item.keepAPK {
				_, err = s.cache.Ensure(wctx, item.source, item.artifact)
			} else {
				err = s.cache.Index(wctx, item.source, item.artifact)
			}
			if err != nil {
				s.log.Debug("cache warm failed", "source", item.source, "artifact", item.artifact.ID, "err", err)
			}
			cancel()
		}
	}
}
