package api

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kriakiku/holtdroid/internal/apk"
	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/contract"
)

type ArtifactView struct {
	Source   string            `json:"source"`
	Artifact contract.Artifact `json:"artifact"`
	Meta     *apk.Metadata     `json:"meta,omitempty"`
	HasIcon  bool              `json:"hasIcon"`
}

type SourceError struct {
	Source  string `json:"source"`
	Message string `json:"message"`
}

type ArtifactList struct {
	Items      []ArtifactView `json:"items"`
	NextCursor string         `json:"nextCursor,omitempty"`
	Errors     []SourceError  `json:"errors"`
}

type SourceView struct {
	Name string `json:"name"`
}

type ProviderView struct {
	Name         string                `json:"name"`
	Capabilities contract.Capabilities `json:"capabilities"`
	Capacity     contract.Capacity     `json:"capacity"`
	Error        string                `json:"error,omitempty"`
}

type SessionView struct {
	Provider     string                `json:"provider"`
	ID           string                `json:"id"`
	Slot         string                `json:"slot"`
	Owner        string                `json:"owner"`
	Package      string                `json:"package"`
	Source       string                `json:"source"`
	ArtifactID   string                `json:"artifactId"`
	Label        string                `json:"label,omitempty"`
	VersionName  string                `json:"versionName,omitempty"`
	HasIcon      bool                  `json:"hasIcon"`
	Location     string                `json:"location,omitempty"`
	State        contract.SessionState `json:"state" enum:"provisioning,booting,installing,instrumenting,ready,stopping,failed"`
	Reason       string                `json:"reason,omitempty"`
	CreatedAt    time.Time             `json:"createdAt"`
	LastActivity time.Time             `json:"lastActivity"`
	IdleDeadline time.Time             `json:"idleDeadline"`
	TTLDeadline  time.Time             `json:"ttlDeadline"`
}

type SessionsEvent struct {
	Items  []SessionView `json:"items"`
	Errors []SourceError `json:"errors"`
}

type out[T any] struct {
	Body T
}

type sessionPath struct {
	Provider string `path:"provider"`
	ID       string `path:"id"`
}

type listArtifactsInput struct {
	Source string `query:"source" doc:"Only list this source; enables cursor paging"`
	Cursor string `query:"cursor"`
	Limit  int    `query:"limit" minimum:"1" maximum:"200" default:"50"`
}

type createSessionInput struct {
	Body struct {
		Source     string `json:"source" minLength:"1"`
		ArtifactID string `json:"artifactId" minLength:"1"`
		Provider   string `json:"provider" minLength:"1"`
		Location   string `json:"location,omitempty"`
	}
}

type heartbeatInput struct {
	Provider string `path:"provider"`
	ID       string `path:"id"`
	Body     struct {
		Active bool `json:"active" doc:"The user interacted with the session page since the last heartbeat"`
	}
}

type iconInput struct {
	Source string `path:"source"`
	ID     string `path:"id"`
}

func (s *Server) register(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{OperationID: "getMe", Method: http.MethodGet, Path: "/api/v1/me", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*out[auth.Identity], error) {
			id, _ := auth.FromContext(ctx)
			return &out[auth.Identity]{id}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "listSources", Method: http.MethodGet, Path: "/api/v1/sources", Tags: tags},
		func(context.Context, *struct{}) (*out[[]SourceView], error) {
			views := make([]SourceView, 0, len(s.srcOrder))
			for _, name := range s.srcOrder {
				views = append(views, SourceView{Name: name})
			}
			return &out[[]SourceView]{views}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "listArtifacts", Method: http.MethodGet, Path: "/api/v1/artifacts", Tags: tags},
		func(ctx context.Context, in *listArtifactsInput) (*out[ArtifactList], error) {
			list, err := s.listArtifacts(ctx, in.Source, in.Cursor, in.Limit)
			if err != nil {
				return nil, httpError(err)
			}
			return &out[ArtifactList]{list}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "getArtifactIcon", Method: http.MethodGet, Path: "/api/v1/artifacts/{source}/{id}/icon", Tags: tags,
		Responses: map[string]*huma.Response{"200": {Description: "PNG icon", Content: map[string]*huma.MediaType{"image/png": {}}}},
	}, func(ctx context.Context, in *iconInput) (*huma.StreamResponse, error) {
		raw, err := s.cache.Icon(ctx, in.Source, in.ID)
		if err != nil {
			return nil, huma.Error404NotFound("no icon")
		}
		return &huma.StreamResponse{Body: func(hctx huma.Context) {
			hctx.SetHeader("Content-Type", "image/png")
			hctx.SetHeader("Cache-Control", "public, max-age=86400")
			_, _ = hctx.BodyWriter().Write(raw)
		}}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "listProviders", Method: http.MethodGet, Path: "/api/v1/providers", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*out[[]ProviderView], error) {
			return &out[[]ProviderView]{s.listProviders(ctx)}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "listSessions", Method: http.MethodGet, Path: "/api/v1/sessions", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*out[SessionsEvent], error) {
			items, errs := s.listSessions(ctx)
			return &out[SessionsEvent]{SessionsEvent{Items: items, Errors: errs}}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "createSession", Method: http.MethodPost, Path: "/api/v1/sessions", Tags: tags, DefaultStatus: http.StatusCreated,
	}, func(ctx context.Context, in *createSessionInput) (*out[SessionView], error) {
		id, _ := auth.FromContext(ctx)
		v, err := s.createSession(ctx, id, in.Body.Source, in.Body.ArtifactID, in.Body.Provider, in.Body.Location)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[SessionView]{v}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "getSession", Method: http.MethodGet, Path: "/api/v1/sessions/{provider}/{id}", Tags: tags},
		func(ctx context.Context, in *sessionPath) (*out[SessionView], error) {
			p, err := s.provider(in.Provider)
			if err != nil {
				return nil, httpError(err)
			}
			sess, err := p.Get(ctx, in.ID)
			if err != nil {
				return nil, httpError(err)
			}
			return &out[SessionView]{s.view(ctx, in.Provider, sess)}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "deleteSession", Method: http.MethodDelete, Path: "/api/v1/sessions/{provider}/{id}", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *sessionPath) (*struct{}, error) {
		p, sess, err := s.ownedSession(ctx, in.Provider, in.ID)
		if err != nil {
			return nil, httpError(err)
		}
		return nil, httpError(p.Delete(ctx, sess.ID))
	})

	huma.Register(api, huma.Operation{
		OperationID: "extendSession", Method: http.MethodPost, Path: "/api/v1/sessions/{provider}/{id}/extend", Tags: tags,
	}, func(ctx context.Context, in *sessionPath) (*out[SessionView], error) {
		_, sess, err := s.ownedSession(ctx, in.Provider, in.ID)
		if err != nil {
			return nil, httpError(err)
		}
		s.activity.Mark(sessionKey{in.Provider, in.ID})
		return &out[SessionView]{s.view(ctx, in.Provider, sess)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "heartbeatSession", Method: http.MethodPost, Path: "/api/v1/sessions/{provider}/{id}/heartbeat", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(_ context.Context, in *heartbeatInput) (*struct{}, error) {
		if _, err := s.provider(in.Provider); err != nil {
			return nil, httpError(err)
		}
		if in.Body.Active {
			s.activity.Mark(sessionKey{in.Provider, in.ID})
		}
		return nil, nil
	})

	s.registerEvents(api)
	s.registerAuth(api)
}

var errForbidden = errors.New("only the owner or an admin can do this")

func httpError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, contract.ErrNotFound):
		return huma.Error404NotFound(err.Error())
	case errors.Is(err, contract.ErrNoCapacity):
		return huma.Error409Conflict(err.Error())
	case errors.Is(err, contract.ErrInvalid):
		return huma.Error422UnprocessableEntity(err.Error())
	case errors.Is(err, errForbidden):
		return huma.Error403Forbidden(err.Error())
	default:
		return huma.Error502BadGateway(err.Error())
	}
}

func (s *Server) provider(name string) (contract.Provider, error) {
	p, ok := s.providers[name]
	if !ok {
		return nil, fmt.Errorf("%w: provider %q", contract.ErrNotFound, name)
	}
	return p, nil
}

func (s *Server) ownedSession(ctx context.Context, provider, id string) (contract.Provider, contract.Session, error) {
	p, err := s.provider(provider)
	if err != nil {
		return nil, contract.Session{}, err
	}
	sess, err := p.Get(ctx, id)
	if err != nil {
		return nil, contract.Session{}, err
	}
	who, _ := auth.FromContext(ctx)
	if !who.Admin && who.User != sess.Owner {
		return nil, contract.Session{}, errForbidden
	}
	return p, sess, nil
}

func (s *Server) listArtifacts(ctx context.Context, source, cursor string, limit int) (ArtifactList, error) {
	names := s.srcOrder
	if source != "" {
		if _, ok := s.sources[source]; !ok {
			return ArtifactList{}, fmt.Errorf("%w: source %q", contract.ErrNotFound, source)
		}
		names = []string{source}
	} else {
		cursor = ""
	}

	type result struct {
		name string
		page contract.ArtifactPage
		err  error
	}
	results := make([]result, len(names))
	var wg sync.WaitGroup
	for i, name := range names {
		wg.Go(func() {
			page, err := s.sources[name].List(ctx, cursor, limit)
			results[i] = result{name, page, err}
		})
	}
	wg.Wait()

	list := ArtifactList{Items: []ArtifactView{}, Errors: []SourceError{}}
	for _, r := range results {
		if r.err != nil {
			list.Errors = append(list.Errors, SourceError{Source: r.name, Message: r.err.Error()})
			continue
		}
		for _, a := range r.page.Items {
			list.Items = append(list.Items, s.artifactView(ctx, r.name, a))
		}
		if source != "" {
			list.NextCursor = r.page.NextCursor
		}
	}
	slices.SortStableFunc(list.Items, func(a, b ArtifactView) int {
		return b.Artifact.UploadedAt.Compare(a.Artifact.UploadedAt)
	})
	s.enqueueWarm(list.Items)
	return list, nil
}

func (s *Server) artifactView(ctx context.Context, source string, a contract.Artifact) ArtifactView {
	v := ArtifactView{Source: source, Artifact: a}
	if e, ok := s.cache.Lookup(ctx, source, a.ID); ok {
		meta := e.Meta
		v.Meta = &meta
		v.HasIcon = e.HasIcon
	}
	return v
}

func (s *Server) enqueueWarm(items []ArtifactView) {
	n := 0
	for _, it := range items {
		if n >= s.cfg.Cache.Warm {
			return
		}
		if it.Meta != nil {
			continue
		}
		n++
		select {
		case s.warm <- [2]string{it.Source, it.Artifact.ID}:
		default:
			return
		}
	}
}

func (s *Server) listProviders(ctx context.Context) []ProviderView {
	views := make([]ProviderView, len(s.provOrder))
	var wg sync.WaitGroup
	for i, name := range s.provOrder {
		wg.Go(func() {
			v := ProviderView{Name: name, Capacity: contract.Capacity{Slots: []contract.Slot{}}}
			p := s.providers[name]
			caps, err := p.Capabilities(ctx)
			if err == nil {
				v.Capabilities = caps
				v.Capacity, err = p.Capacity(ctx)
			}
			if err != nil {
				v.Error = err.Error()
			}
			if v.Capabilities.Locations == nil {
				v.Capabilities.Locations = []contract.Location{}
			}
			if v.Capabilities.ABIs == nil {
				v.Capabilities.ABIs = []string{}
			}
			views[i] = v
		})
	}
	wg.Wait()
	return views
}

func (s *Server) allSessions(ctx context.Context) (map[string][]contract.Session, []SourceError) {
	type result struct {
		name  string
		items []contract.Session
		err   error
	}
	results := make([]result, len(s.provOrder))
	var wg sync.WaitGroup
	for i, name := range s.provOrder {
		wg.Go(func() {
			items, err := s.providers[name].List(ctx)
			results[i] = result{name, items, err}
		})
	}
	wg.Wait()

	out := map[string][]contract.Session{}
	errs := []SourceError{}
	for _, r := range results {
		if r.err != nil {
			errs = append(errs, SourceError{Source: r.name, Message: r.err.Error()})
			continue
		}
		out[r.name] = r.items
	}
	return out, errs
}

func (s *Server) listSessions(ctx context.Context) ([]SessionView, []SourceError) {
	all, errs := s.allSessions(ctx)
	views := []SessionView{}
	for provider, items := range all {
		for _, sess := range items {
			views = append(views, s.view(ctx, provider, sess))
		}
	}
	slices.SortFunc(views, func(a, b SessionView) int {
		return cmp.Or(a.CreatedAt.Compare(b.CreatedAt), cmp.Compare(a.Provider+a.ID, b.Provider+b.ID))
	})
	return views, errs
}

func (s *Server) lastActivity(provider string, sess contract.Session) time.Time {
	last := sess.CreatedAt
	if sess.LastActivity.After(last) {
		last = sess.LastActivity
	}
	if t, ok := s.activity.Get(sessionKey{provider, sess.ID}); ok && t.After(last) {
		last = t
	}
	return last.UTC()
}

func (s *Server) view(ctx context.Context, provider string, sess contract.Session) SessionView {
	source, artifactID := splitRef(sess.ArtifactRef)
	last := s.lastActivity(provider, sess)
	v := SessionView{
		Provider:     provider,
		ID:           sess.ID,
		Slot:         sess.Slot,
		Owner:        sess.Owner,
		Package:      sess.Package,
		Source:       source,
		ArtifactID:   artifactID,
		Location:     sess.Location,
		State:        sess.State,
		Reason:       sess.Reason,
		CreatedAt:    sess.CreatedAt,
		LastActivity: last,
		IdleDeadline: last.Add(s.cfg.Sessions.IdleTimeout),
		TTLDeadline:  sess.CreatedAt.Add(s.cfg.Sessions.MaxTTL),
	}
	if e, ok := s.cache.Lookup(ctx, source, artifactID); ok {
		v.Label = e.Meta.Label
		v.VersionName = e.Meta.VersionName
		v.HasIcon = e.HasIcon
	}
	return v
}

func (s *Server) createSession(ctx context.Context, who auth.Identity, source, artifactID, providerName, location string) (SessionView, error) {
	p, err := s.provider(providerName)
	if err != nil {
		return SessionView{}, err
	}
	if _, ok := s.sources[source]; !ok {
		return SessionView{}, fmt.Errorf("%w: source %q", contract.ErrNotFound, source)
	}
	if location != "" {
		caps, err := p.Capabilities(ctx)
		if err != nil {
			return SessionView{}, err
		}
		if !slices.ContainsFunc(caps.Locations, func(l contract.Location) bool { return l.ID == location }) {
			return SessionView{}, fmt.Errorf("%w: unknown location %q", contract.ErrInvalid, location)
		}
	}
	capacity, err := p.Capacity(ctx)
	if err != nil {
		return SessionView{}, err
	}
	if capacity.Free() == 0 {
		return SessionView{}, contract.ErrNoCapacity
	}

	entry, err := s.cache.Ensure(ctx, source, artifactID)
	if err != nil {
		return SessionView{}, err
	}
	sess, err := p.Create(ctx, contract.CreateSession{
		ArtifactURL: s.artifactURL(source, artifactID),
		ArtifactRef: source + "/" + artifactID,
		Package:     entry.Meta.Package,
		Owner:       who.User,
		Location:    location,
	})
	if err != nil {
		return SessionView{}, err
	}
	s.activity.Mark(sessionKey{providerName, sess.ID})
	s.log.Info("session created", "provider", providerName, "session", sess.ID, "owner", who.User, "package", entry.Meta.Package)
	return s.view(ctx, providerName, sess), nil
}

func splitRef(ref string) (string, string) {
	source, id, _ := strings.Cut(ref, "/")
	return source, id
}
