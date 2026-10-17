package api

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kriakiku/holtdroid/internal/audit"
	"github.com/kriakiku/holtdroid/internal/auth"
)

type AuditInfo struct {
	Enabled    bool       `json:"enabled" doc:"audit.store is on: events can be browsed here"`
	Events     int        `json:"events"`
	Oldest     *time.Time `json:"oldest,omitempty"`
	MaxEvents  int        `json:"maxEvents"`
	MaxAge     int64      `json:"maxAge" doc:"seconds, 0: no age limit"`
	Persistent bool       `json:"persistent" doc:"kept in a file across restarts"`
	Actors     []string   `json:"actors"`
	Actions    []string   `json:"actions"`
}

type AuditEvent struct {
	ID uint64 `json:"id"`
	audit.Event
}

type AuditPage struct {
	Items []AuditEvent `json:"items"`
	Next  uint64       `json:"next,omitempty" doc:"pass as before for older events; absent on the last page"`
}

type AuditFilter struct {
	Action  []string  `query:"action" doc:"actions or categories, e.g. session or ssh.tunnel"`
	Result  []string  `query:"result" doc:"ok, denied or failed"`
	Service []string  `query:"service"`
	Actor   string    `query:"actor"`
	Session string    `query:"session"`
	Q       string    `query:"q" maxLength:"200" doc:"case-insensitive text in any field"`
	Since   time.Time `query:"since"`
	Until   time.Time `query:"until"`
}

func (f AuditFilter) query() audit.Query {
	results := make([]audit.Result, 0, len(f.Result))
	for _, r := range f.Result {
		results = append(results, audit.Result(r))
	}
	return audit.Query{
		Actions: f.Action, Results: results, Services: f.Service, Actor: f.Actor, Session: f.Session,
		Text: f.Q, Since: f.Since, Until: f.Until,
	}
}

type auditEventsInput struct {
	AuditFilter
	Before uint64 `query:"before"`
	Limit  int    `query:"limit" minimum:"1" maximum:"500" default:"100"`
}

func (s *Server) auditStore(ctx context.Context) (*audit.Store, error) {
	if who, _ := auth.FromContext(ctx); !who.Admin {
		return nil, huma.Error403Forbidden("only admins can read the audit log")
	}
	st := s.audit.Store()
	if st == nil {
		return nil, huma.Error404NotFound("audit.store is disabled")
	}
	return st, nil
}

func (s *Server) registerAudit(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "getAuditInfo", Method: http.MethodGet, Path: "/api/v1/admin/audit", Tags: tags,
		Description: "What the api's audit store keeps. Admins only.",
	}, func(ctx context.Context, _ *struct{}) (*out[AuditInfo], error) {
		if who, _ := auth.FromContext(ctx); !who.Admin {
			return nil, huma.Error403Forbidden("only admins can read the audit log")
		}
		info := AuditInfo{Actors: []string{}, Actions: make([]string, 0, len(audit.Actions))}
		for _, a := range audit.Actions {
			info.Actions = append(info.Actions, string(a))
		}
		if st := s.audit.Store(); st != nil {
			stats := st.Stats()
			info.Enabled, info.Events, info.MaxEvents, info.MaxAge, info.Persistent =
				true, stats.Events, stats.MaxEvents, int64(stats.MaxAge/time.Second), stats.Persistent
			if !stats.Oldest.IsZero() {
				info.Oldest = &stats.Oldest
			}
			if stats.Actors != nil {
				info.Actors = stats.Actors
			}
		}
		return &out[AuditInfo]{info}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "listAuditEvents", Method: http.MethodGet, Path: "/api/v1/admin/audit/events", Tags: tags,
		Description: "Recent audit events, newest first. Admins only.",
	}, func(ctx context.Context, in *auditEventsInput) (*out[AuditPage], error) {
		st, err := s.auditStore(ctx)
		if err != nil {
			return nil, err
		}
		if err := validResults(in.Result); err != nil {
			return nil, err
		}
		q := in.query()
		q.Before, q.Limit = in.Before, in.Limit
		events, more := st.Query(q)
		page := AuditPage{Items: make([]AuditEvent, 0, len(events))}
		for _, e := range events {
			page.Items = append(page.Items, AuditEvent{e.ID, e.Event})
		}
		if more && len(events) > 0 {
			page.Next = events[len(events)-1].ID
		}
		return &out[AuditPage]{page}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "exportAuditEvents", Method: http.MethodGet, Path: "/api/v1/admin/audit/export", Tags: tags,
		Description: "Every matching audit event as JSON lines, newest first. Admins only.",
		Responses:   map[string]*huma.Response{"200": {Description: "JSON lines", Content: map[string]*huma.MediaType{"application/x-ndjson": {}}}},
	}, func(ctx context.Context, in *AuditFilter) (*huma.StreamResponse, error) {
		st, err := s.auditStore(ctx)
		if err != nil {
			return nil, err
		}
		if err := validResults(in.Result); err != nil {
			return nil, err
		}
		events, _ := st.Query(in.query())
		s.emit(ctx, audit.Event{Action: audit.AuditExport, Details: map[string]string{"events": strconv.Itoa(len(events)), "q": in.Q}})
		name := "holtdroid-audit-" + s.now().UTC().Format("20060102T150405Z") + ".jsonl"
		return &huma.StreamResponse{Body: func(hctx huma.Context) {
			hctx.SetHeader("Content-Type", "application/x-ndjson")
			hctx.SetHeader("Content-Disposition", `attachment; filename="`+name+`"`)
			enc := json.NewEncoder(hctx.BodyWriter())
			for _, e := range events {
				_ = enc.Encode(e.Event)
			}
		}}, nil
	})
}

func validResults(results []string) error {
	for _, r := range results {
		if !slices.Contains([]audit.Result{audit.OK, audit.Denied, audit.Failed}, audit.Result(r)) {
			return huma.Error422UnprocessableEntity("result must be ok, denied or failed")
		}
	}
	return nil
}

// RecordAudit keeps events another service emitted in the audit store; they
// were already written to that service's own sinks.
func (s *Server) RecordAudit(ctx context.Context, events []audit.Event) error {
	st := s.audit.Store()
	if st == nil {
		return nil
	}
	for _, ev := range events {
		if ev.Action == "" {
			continue
		}
		if ev.Time.IsZero() {
			ev.Time = s.now()
		}
		st.Write(ctx, ev)
	}
	return nil
}
