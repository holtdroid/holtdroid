package api

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kriakiku/holtdroid/internal/audit"
	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/source"
)

type SourceError struct {
	Source  string `json:"source"`
	Message string `json:"message"`
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
	IconURL      string                `json:"iconUrl,omitempty"`
	Location     string                `json:"location,omitempty"`
	State        contract.SessionState `json:"state" enum:"provisioning,booting,installing,instrumenting,ready,stopping,failed"`
	Reason       string                `json:"reason,omitempty"`
	Detail       string                `json:"detail,omitempty"`
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

type createSessionInput struct {
	Body struct {
		Source     string `json:"source" minLength:"1"`
		ArtifactID string `json:"artifactId" minLength:"1"`
		Provider   string `json:"provider" minLength:"1"`
		Location   string `json:"location,omitempty"`
	}
}

type installInput struct {
	Provider string `path:"provider"`
	ID       string `path:"id"`
	Body     struct {
		Source     string `json:"source" minLength:"1"`
		ArtifactID string `json:"artifactId" minLength:"1"`
		KeepData   bool   `json:"keepData" doc:"Install over the current build, upgrade or downgrade, keeping the app's data; otherwise uninstall it first"`
	}
}

type heartbeatInput struct {
	Provider string `path:"provider"`
	ID       string `path:"id"`
	Body     struct {
		Active bool `json:"active" doc:"The user interacted with the session page since the last heartbeat"`
	}
}

func (s *Server) register(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{OperationID: "getMe", Method: http.MethodGet, Path: "/api/v1/me", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*out[auth.Identity], error) {
			id, _ := auth.FromContext(ctx)
			return &out[auth.Identity]{id}, nil
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
		result, _ := outcome(err)
		launchesTotal.WithLabelValues(in.Body.Provider, string(result)).Inc()
		if err != nil {
			s.emitResult(ctx, audit.Event{
				Action: audit.SessionLaunch, Provider: in.Body.Provider,
				Artifact: requested(in.Body.Source, in.Body.ArtifactID), Details: map[string]string{"location": in.Body.Location},
			}, err)
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
		ev := audit.Event{Action: audit.SessionStop, Provider: in.Provider, Session: in.ID}
		p, sess, err := s.ownedSession(ctx, in.Provider, in.ID)
		if err == nil {
			ev.Artifact = sess.ArtifactRef
			err = p.Delete(ctx, sess.ID)
		}
		s.emitResult(ctx, ev, err)
		if err != nil {
			return nil, httpError(err)
		}
		s.agents.forget(sessionKey{in.Provider, sess.ID})
		sessionsEnded.WithLabelValues(in.Provider, "stopped").Inc()
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "extendSession", Method: http.MethodPost, Path: "/api/v1/sessions/{provider}/{id}/extend", Tags: tags,
	}, func(ctx context.Context, in *sessionPath) (*out[SessionView], error) {
		_, sess, err := s.ownedSession(ctx, in.Provider, in.ID)
		s.emitResult(ctx, audit.Event{Action: audit.SessionExtend, Provider: in.Provider, Session: in.ID, Artifact: sess.ArtifactRef}, err)
		if err != nil {
			return nil, httpError(err)
		}
		s.activity.Mark(sessionKey{in.Provider, in.ID})
		return &out[SessionView]{s.view(ctx, in.Provider, sess)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "installSessionArtifact", Method: http.MethodPost, Path: "/api/v1/sessions/{provider}/{id}/install", Tags: tags,
		Description: "Replaces the app in a running session with another build of the same package and starts it.",
	}, func(ctx context.Context, in *installInput) (*out[SessionView], error) {
		v, err := s.installArtifact(ctx, in.Provider, in.ID, in.Body.Source, in.Body.ArtifactID, in.Body.KeepData)
		if err != nil {
			s.emitResult(ctx, audit.Event{
				Action: audit.SessionInstall, Provider: in.Provider, Session: in.ID,
				Artifact: requested(in.Body.Source, in.Body.ArtifactID), Details: map[string]string{"keepData": strconv.FormatBool(in.Body.KeepData)},
			}, err)
			return nil, httpError(err)
		}
		return &out[SessionView]{v}, nil
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

	s.registerArtifacts(api)
	s.registerEvents(api)
	s.registerAuth(api)
	s.registerSSH(api)
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
	case errors.Is(err, errForbidden), errors.Is(err, source.ErrReadOnly), errors.Is(err, errUploadsDisabled):
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
	srcName, key, rev := splitRef(sess.ArtifactRef)
	last := s.lastActivity(provider, sess)
	s.launches.observe(provider, sess, s.now())
	v := SessionView{
		Provider:     provider,
		ID:           sess.ID,
		Slot:         sess.Slot,
		Owner:        sess.Owner,
		Package:      sess.Package,
		Source:       srcName,
		ArtifactID:   encodeID(key),
		Location:     sess.Location,
		State:        sess.State,
		Reason:       sess.Reason,
		Detail:       sess.Detail,
		CreatedAt:    sess.CreatedAt,
		LastActivity: last,
		IdleDeadline: last.Add(s.cfg.Sessions.IdleTimeout),
		TTLDeadline:  sess.CreatedAt.Add(s.cfg.Sessions.MaxTTL),
	}
	if e, ok := s.cache.Lookup(ctx, srcName, key, rev); ok {
		v.Label = e.Meta.Label
		v.VersionName = e.Meta.VersionName
		v.IconURL = iconURL(e)
	}
	return v
}

func (s *Server) createSession(ctx context.Context, who auth.Identity, srcName, artifactID, providerName, location string) (SessionView, error) {
	p, err := s.provider(providerName)
	if err != nil {
		return SessionView{}, err
	}
	src, err := s.source(srcName)
	if err != nil {
		return SessionView{}, err
	}
	key, err := decodeID(artifactID)
	if err != nil {
		return SessionView{}, err
	}
	artifact, err := src.Get(ctx, key)
	if err != nil {
		return SessionView{}, err
	}
	if !artifact.VisibleTo(who.User, who.Admin) {
		return SessionView{}, fmt.Errorf("%w: %s", contract.ErrNotFound, artifactID)
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

	entry, err := s.cache.Ensure(ctx, srcName, artifact)
	if err != nil {
		return SessionView{}, err
	}
	ref := artifactRef(srcName, artifact.ID, artifact.Revision)
	sess, err := p.Create(ctx, contract.CreateSession{
		ArtifactURL: s.artifactURL(entry.Key),
		ArtifactRef: ref,
		Package:     entry.Meta.Package,
		Owner:       who.User,
		Location:    location,
	})
	if err != nil {
		return SessionView{}, err
	}
	s.activity.Mark(sessionKey{providerName, sess.ID})
	s.launches.add(sessionKey{providerName, sess.ID}, s.now())
	s.markUsed(ctx, srcName, artifact)
	s.emit(ctx, audit.Event{
		Action: audit.SessionLaunch, Provider: providerName, Session: sess.ID, Artifact: ref,
		Details: map[string]string{"package": entry.Meta.Package, "location": location},
	})
	s.log.Info("session created", "provider", providerName, "session", sess.ID, "owner", who.User, "package", entry.Meta.Package)
	return s.view(ctx, providerName, sess), nil
}

func (s *Server) installArtifact(ctx context.Context, providerName, id, srcName, artifactID string, keepData bool) (SessionView, error) {
	p, sess, err := s.ownedSession(ctx, providerName, id)
	if err != nil {
		return SessionView{}, err
	}
	src, err := s.source(srcName)
	if err != nil {
		return SessionView{}, err
	}
	key, err := decodeID(artifactID)
	if err != nil {
		return SessionView{}, err
	}
	artifact, err := src.Get(ctx, key)
	if err != nil {
		return SessionView{}, err
	}
	who, _ := auth.FromContext(ctx)
	if !artifact.VisibleTo(who.User, who.Admin) {
		return SessionView{}, fmt.Errorf("%w: %s", contract.ErrNotFound, artifactID)
	}
	entry, err := s.cache.Ensure(ctx, srcName, artifact)
	if err != nil {
		return SessionView{}, err
	}
	if entry.Meta.Package != sess.Package {
		return SessionView{}, fmt.Errorf("%w: %s is %s, the session runs %s", contract.ErrInvalid, artifact.FileName, entry.Meta.Package, sess.Package)
	}
	ref := artifactRef(srcName, artifact.ID, artifact.Revision)
	s.activity.Mark(sessionKey{providerName, id})
	updated, err := p.Install(ctx, id, contract.Install{ArtifactURL: s.artifactURL(entry.Key), ArtifactRef: ref, KeepData: keepData})
	if err != nil {
		return SessionView{}, err
	}
	s.activity.Mark(sessionKey{providerName, id})
	s.markUsed(ctx, srcName, artifact)
	s.emit(ctx, audit.Event{
		Action: audit.SessionInstall, Provider: providerName, Session: id, Artifact: ref,
		Details: map[string]string{"package": entry.Meta.Package, "keepData": strconv.FormatBool(keepData)},
	})
	s.log.Info("session build replaced", "provider", providerName, "session", id, "by", who.User, "artifact", ref, "keepData", keepData)
	return s.view(ctx, providerName, updated), nil
}

func artifactRef(source, id, rev string) string { return source + "/" + id + "@" + rev }

func splitRef(ref string) (source, id, rev string) {
	source, rest, _ := strings.Cut(ref, "/")
	if id, rev, ok := strings.CutLast(rest, "@"); ok {
		return source, id, rev
	}
	return source, rest, ""
}
