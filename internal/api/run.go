package api

import (
	"context"
	"time"

	"github.com/kriakiku/holtdroid/internal/contract"
)

// Run drives background work until ctx is cancelled: reaping idle and expired
// sessions, flushing activity to providers and warming the APK cache.
func (s *Server) Run(ctx context.Context) {
	reap := time.NewTicker(s.cfg.Sessions.ReapInterval)
	flush := time.NewTicker(s.cfg.Sessions.FlushInterval)
	defer reap.Stop()
	defer flush.Stop()

	go s.warmLoop(ctx)

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
	alive := map[sessionKey]bool{}
	for provider, items := range all {
		for _, sess := range items {
			key := sessionKey{provider, sess.ID}
			alive[key] = true
			reason := ""
			switch {
			case now.Sub(sess.CreatedAt) > s.cfg.Sessions.MaxTTL:
				reason = "max TTL reached"
			case now.Sub(s.lastActivity(provider, sess)) > s.cfg.Sessions.IdleTimeout:
				reason = "idle timeout"
			}
			if reason == "" || sess.State == contract.StateStopping {
				continue
			}
			if err := s.providers[provider].Delete(ctx, sess.ID); err != nil {
				s.log.Warn("reaper could not delete session", "provider", provider, "session", sess.ID, "err", err)
				continue
			}
			s.recordEvent(ctx, provider, sess.ID, "reaped", "", sess.ArtifactRef, reason)
			s.log.Info("session reaped", "provider", provider, "session", sess.ID, "owner", sess.Owner, "reason", reason)
		}
	}
	if len(errs) == 0 {
		s.activity.Retain(alive)
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
			if _, ok := s.cache.Lookup(ctx, item[0], item[1]); ok {
				continue
			}
			wctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
			if _, err := s.cache.Ensure(wctx, item[0], item[1]); err != nil {
				s.log.Debug("cache warm failed", "source", item[0], "artifact", item[1], "err", err)
			}
			cancel()
		}
	}
}
