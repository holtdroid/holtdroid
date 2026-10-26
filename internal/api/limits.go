package api

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
)

var errTooManySessions = errors.New("you already run as many devices as you may; stop one first")

type limits struct {
	MaxSessions     int
	MaxSessionTTL   time.Duration
	RecordingsQuota int64
	AppDataMaxSize  int64
	ReferencesQuota int64
}

// roleLimits is the server-wide settings with a role's nonzero limits from
// auth.users.limits on top.
func (s *Server) roleLimits(r auth.Limits) limits {
	l := limits{
		MaxSessions: s.cfg.Sessions.MaxPerUser, MaxSessionTTL: s.cfg.Sessions.MaxTTL,
		RecordingsQuota: int64(s.cfg.Recordings.Quota), AppDataMaxSize: int64(s.cfg.AppData.MaxSize),
		ReferencesQuota: int64(s.cfg.PixelPerfect.Quota),
	}
	if r.MaxSessions > 0 {
		l.MaxSessions = r.MaxSessions
	}
	if r.MaxSessionTTL > 0 {
		l.MaxSessionTTL = r.MaxSessionTTL
	}
	if r.RecordingsQuota > 0 {
		l.RecordingsQuota = int64(r.RecordingsQuota)
	}
	if r.AppDataMaxSize > 0 {
		l.AppDataMaxSize = int64(r.AppDataMaxSize)
	}
	if r.ReferencesQuota > 0 {
		l.ReferencesQuota = int64(r.ReferencesQuota)
	}
	return l
}

// limits resolves user's limits: their own overrides in the users mode win
// over their role's, which win over the server-wide settings.
func (s *Server) limits(ctx context.Context, user string) limits {
	if s.users == nil || user == "" {
		return s.roleLimits(auth.Limits{})
	}
	role, own, ok := s.users.Limits(ctx, user)
	if !ok {
		return s.roleLimits(auth.Limits{})
	}
	l := s.roleLimits(role)
	if own.MaxSessions != nil {
		l.MaxSessions = int(*own.MaxSessions)
	}
	if own.MaxSessionTTL != nil && *own.MaxSessionTTL > 0 {
		l.MaxSessionTTL = time.Duration(*own.MaxSessionTTL) * time.Second
	}
	if own.RecordingsQuota != nil {
		l.RecordingsQuota = *own.RecordingsQuota
	}
	if own.AppDataMaxSize != nil {
		l.AppDataMaxSize = *own.AppDataMaxSize
	}
	if own.ReferencesQuota != nil {
		l.ReferencesQuota = *own.ReferencesQuota
	}
	return l
}

func (s *Server) checkSessionLimit(ctx context.Context, user string) error {
	max := s.limits(ctx, user).MaxSessions
	if max <= 0 {
		return nil
	}
	items, _ := s.listSessions(ctx)
	n := 0
	for _, v := range items {
		if v.Owner == user && v.State != contract.StateStopping {
			n++
		}
	}
	if n >= max {
		return fmt.Errorf("%w (%d)", errTooManySessions, max)
	}
	return nil
}
