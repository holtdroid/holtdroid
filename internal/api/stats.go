package api

import (
	"context"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/auth"
)

const (
	reapTTL  = "max TTL reached"
	reapIdle = "idle timeout"

	maxStatsRange    = 400 * 24 * time.Hour
	maxStatsSessions = 50000
)

type StatsSession struct {
	Provider  string     `json:"provider"`
	ID        string     `json:"id"`
	Start     time.Time  `json:"start"`
	End       *time.Time `json:"end,omitempty" doc:"absent while running or when the session ended without a stop or reap"`
	Ended     string     `json:"ended,omitempty" enum:"stopped,idle,ttl,reaped" doc:"stopped by a person, or reaped by the api"`
	Actor     string     `json:"actor,omitempty"`
	ActorName string     `json:"actorName,omitempty" doc:"the actor's name when it is an account of the users mode"`
	Artifact  string     `json:"artifact,omitempty"`
	Package   string     `json:"package,omitempty" doc:"recorded for sessions launched since the column exists"`
	Extended  int        `json:"extended,omitempty"`
}

type SessionStats struct {
	Since     time.Time      `json:"since"`
	Until     time.Time      `json:"until"`
	Items     []StatsSession `json:"items"`
	Truncated bool           `json:"truncated,omitempty" doc:"more sessions than one response holds; the newest are left out"`
}

type statsInput struct {
	Since time.Time `query:"since" required:"true"`
	Until time.Time `query:"until" doc:"default: now"`
}

func (s *Server) registerStats(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "getSessionStats", Method: http.MethodGet, Path: "/api/v1/admin/stats/sessions", Tags: []string{"ui"},
		Description: "Sessions launched in a time range with how and when they ended, from the session_events table. Admins only.",
	}, func(ctx context.Context, in *statsInput) (*out[SessionStats], error) {
		if who, _ := auth.FromContext(ctx); !who.Admin {
			return nil, huma.Error403Forbidden("only admins can read usage statistics")
		}
		until := in.Until
		if until.IsZero() {
			until = s.now()
		}
		if !in.Since.Before(until) || until.Sub(in.Since) > maxStatsRange {
			return nil, huma.Error422UnprocessableEntity("since must be before until and at most 400 days earlier")
		}
		stats, err := s.sessionStats(ctx, in.Since, until)
		if err != nil {
			return nil, err
		}
		return &out[SessionStats]{stats}, nil
	})
}

func (s *Server) sessionStats(ctx context.Context, since, until time.Time) (SessionStats, error) {
	rows, err := s.db.ListLifecycleEventsSince(ctx, since)
	if err != nil {
		return SessionStats{}, err
	}
	names := s.userNames(ctx)
	stats := SessionStats{Since: since, Until: until, Items: []StatsSession{}}
	index := map[sessionKey]int{}
	for _, r := range rows {
		k := sessionKey{r.Provider, r.SessionID}
		if audit.Action(r.Action) == audit.SessionLaunch {
			if r.At.After(until) {
				continue
			}
			if len(stats.Items) == maxStatsSessions {
				stats.Truncated = true
				continue
			}
			index[k] = len(stats.Items)
			stats.Items = append(stats.Items, StatsSession{
				Provider: r.Provider, ID: r.SessionID, Start: r.At, Actor: r.Actor, ActorName: names[r.Actor],
				Artifact: r.Artifact, Package: r.Package,
			})
			continue
		}
		i, ok := index[k]
		if !ok || stats.Items[i].End != nil {
			continue
		}
		item := &stats.Items[i]
		switch audit.Action(r.Action) {
		case audit.SessionExtend:
			item.Extended++
		case audit.SessionStop:
			item.End, item.Ended = &r.At, "stopped"
		case audit.SessionReap:
			item.End, item.Ended = &r.At, map[string]string{reapIdle: "idle", reapTTL: "ttl"}[r.Reason]
			if item.Ended == "" {
				item.Ended = "reaped"
			}
		}
	}
	return stats, nil
}
