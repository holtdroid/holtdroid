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

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/source"
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
	Provider     string                     `json:"provider"`
	ID           string                     `json:"id"`
	Slot         string                     `json:"slot"`
	Owner        string                     `json:"owner"`
	OwnerName    string                     `json:"ownerName,omitempty" doc:"the owner's name in the users sign-in mode"`
	Package      string                     `json:"package"`
	Source       string                     `json:"source"`
	ArtifactID   string                     `json:"artifactId"`
	Label        string                     `json:"label,omitempty"`
	VersionName  string                     `json:"versionName,omitempty"`
	IconURL      string                     `json:"iconUrl,omitempty"`
	Location     string                     `json:"location,omitempty"`
	AppData      contract.AppDataKind       `json:"appData,omitempty" enum:"data,cache" doc:"the app data restored at launch: data, or data with its cache; empty for a fresh install"`
	WebView      string                     `json:"webview,omitempty" doc:"the version of the WebView build installed at launch; empty for the built-in WebView"`
	SaveAppData  bool                       `json:"saveAppData,omitempty" doc:"the app's data is saved when the session is stopped or reaped"`
	State        contract.SessionState      `json:"state" enum:"provisioning,booting,installing,restoring,instrumenting,ready,stopping,failed"`
	Reason       string                     `json:"reason,omitempty"`
	Detail       string                     `json:"detail,omitempty"`
	CreatedAt    time.Time                  `json:"createdAt"`
	LastActivity time.Time                  `json:"lastActivity"`
	IdleDeadline time.Time                  `json:"idleDeadline"`
	TTLDeadline  time.Time                  `json:"ttlDeadline"`
	Capabilities *contract.SlotCapabilities `json:"capabilities,omitempty" doc:"what the session's device can do, when its provider reports it per slot"`
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
		Source      string         `json:"source" minLength:"1"`
		ArtifactID  string         `json:"artifactId" minLength:"1"`
		Provider    string         `json:"provider,omitempty" doc:"empty picks the first provider in the configured order with a free device"`
		Slot        string         `json:"slot,omitempty" doc:"a device of the provider; empty picks any free one"`
		Screen      string         `json:"screen,omitempty" doc:"a screen of the provider (virtual devices); empty takes its first"`
		Android     string         `json:"android,omitempty" doc:"an Android version of the provider (virtual devices); empty takes its newest"`
		Location    string         `json:"location,omitempty"`
		AppData     *AppDataChoice `json:"appData,omitempty" doc:"start the app with saved app data instead of a fresh install"`
		WebView     string         `json:"webview,omitempty" doc:"a build from GET /api/v1/webviews to install over the built-in WebView; only providers with the webview capability take it"`
		Queue       bool           `json:"queue,omitempty" doc:"when every slot is busy, wait in line for one instead of failing; cancelling the request gives up the place"`
		Record      *bool          `json:"record,omitempty" doc:"record the session from its start; empty follows the server's recordings.auto"`
		DarkMode    *bool          `json:"darkMode,omitempty" doc:"turn the device's dark theme on or off before the app first starts; empty leaves the device's own"`
		SaveAppData bool           `json:"saveAppData,omitempty" doc:"save the app's data when the session is stopped or reaped; it can always be saved by hand"`
		ImageScan   bool           `json:"imageScan,omitempty" doc:"run the agent's script in the app's pages that reports where they draw their images, for the Images tab; it can be turned on later"`
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

	huma.Register(api, huma.Operation{OperationID: "listWebViews", Method: http.MethodGet, Path: "/api/v1/webviews", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*out[[]WebViewView], error) {
			items, err := s.webviews.list(ctx)
			if err != nil {
				return nil, httpError(err)
			}
			return &out[[]WebViewView]{items}, nil
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
		v, err := s.createSession(ctx, id, launchRequest{
			source: in.Body.Source, artifactID: in.Body.ArtifactID, provider: in.Body.Provider, slot: in.Body.Slot,
			screen: in.Body.Screen, android: in.Body.Android, location: in.Body.Location, appData: in.Body.AppData, webview: in.Body.WebView, queue: in.Body.Queue,
			record: in.Body.Record, darkMode: in.Body.DarkMode, saveAppData: in.Body.SaveAppData, imageScan: in.Body.ImageScan,
		})
		result, _ := outcome(err)
		launchesTotal.WithLabelValues(cmp.Or(v.Provider, in.Body.Provider, "any"), string(result)).Inc()
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
			ctx := context.WithoutCancel(ctx)
			ev.Artifact = sess.ArtifactRef
			if sess.SaveAppData {
				_, _, _ = s.saveAppData(ctx, in.Provider, sess, "stop", false)
			}
			s.stopRecording(ctx, in.Provider, sess)
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
	s.registerApps(api)
	s.registerEvents(api)
	s.registerAuth(api)
	s.registerSSH(api)
	s.registerConnect(api)
	s.registerADB(api)
	s.registerAudit(api)
	s.registerUsers(api)
	s.registerAppData(api)
	s.registerRecordings(api)
	s.registerReferences(api)
	s.registerMedia(api)
	s.registerInventory(api)
	s.registerDevToolsFrontends(api)
	s.registerMap(api)
	s.registerDNSPresets(api)
	s.registerNetwork(api)
	s.registerIPInfo(api)
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
	case errors.Is(err, errForbidden), errors.Is(err, source.ErrReadOnly), errors.Is(err, errUploadsDisabled), errors.Is(err, errDownloadsAdmin),
		errors.Is(err, errAppDataDisabled), errors.Is(err, errAppDataExport), errors.Is(err, errRecordAlways), errors.Is(err, errRecordingsDisabled), errors.Is(err, errSharingDisabled),
		errors.Is(err, errReferencesDisabled), errors.Is(err, errMediaDisabled):
		return huma.Error403Forbidden(err.Error())
	case errors.Is(err, contract.ErrBusy):
		return huma.Error423Locked(err.Error())
	case errors.Is(err, errTooManySessions):
		return huma.Error429TooManyRequests(err.Error())
	case errors.Is(err, contract.ErrTooLarge):
		return huma.Error413RequestEntityTooLarge(err.Error())
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
		AppData:      sess.AppData,
		WebView:      sess.WebView,
		SaveAppData:  sess.SaveAppData,
		State:        sess.State,
		Reason:       sess.Reason,
		Detail:       sess.Detail,
		CreatedAt:    sess.CreatedAt,
		LastActivity: last,
		IdleDeadline: last.Add(s.cfg.Sessions.IdleTimeout),
		TTLDeadline:  sess.CreatedAt.Add(s.limits(ctx, sess.Owner).MaxSessionTTL),
		Capabilities: sess.Capabilities,
	}
	if s.users != nil && sess.Owner != "" {
		v.OwnerName = s.users.Name(ctx, sess.Owner)
	}
	if e, ok := s.cache.Lookup(ctx, srcName, key, rev); ok {
		v.Label = e.Meta.Label
		v.VersionName = e.Meta.VersionName
		v.IconURL = iconURL(e)
	}
	return v
}

type launchRequest struct {
	source, artifactID, provider, slot, screen, android, location, webview string
	appData                                                                *AppDataChoice
	queue, saveAppData, imageScan                                          bool
	record, darkMode                                                       *bool
}

type launchTarget struct {
	provider, slot string
}

func (s *Server) createSession(ctx context.Context, who auth.Identity, req launchRequest) (SessionView, error) {
	if req.slot != "" && req.provider == "" {
		return SessionView{}, fmt.Errorf("%w: a slot needs a provider", contract.ErrInvalid)
	}
	candidates := s.provOrder
	if req.provider != "" {
		if _, err := s.provider(req.provider); err != nil {
			return SessionView{}, err
		}
		candidates = []string{req.provider}
	}
	src, err := s.source(req.source)
	if err != nil {
		return SessionView{}, err
	}
	key, err := decodeID(req.artifactID)
	if err != nil {
		return SessionView{}, err
	}
	artifact, err := src.Get(ctx, key)
	if err != nil {
		return SessionView{}, err
	}
	if !artifact.VisibleTo(who.User, who.Admin) {
		return SessionView{}, fmt.Errorf("%w: %s", contract.ErrNotFound, req.artifactID)
	}
	if err := s.checkSessionLimit(ctx, who.User); err != nil {
		return SessionView{}, err
	}
	if req.location != "" {
		if candidates = s.offering(ctx, candidates, req.location); len(candidates) == 0 {
			return SessionView{}, fmt.Errorf("%w: unknown location %q", contract.ErrInvalid, req.location)
		}
	}

	webview, candidates, err := s.webviewFor(ctx, req.webview, req.android, candidates)
	if err != nil {
		return SessionView{}, err
	}

	entry, err := s.cache.Ensure(ctx, req.source, artifact)
	if err != nil {
		return SessionView{}, err
	}
	if need, level := requiredSDK(entry.Meta.MinSDK, artifact.Meta.Tags), apiLevels[req.android]; level > 0 && need > level {
		return SessionView{}, fmt.Errorf("%w: %s needs Android API level %d, Android %s is %d", contract.ErrInvalid, artifact.FileName, need, req.android, level)
	}
	restore, snapshot, err := s.restoreFor(ctx, who.User, entry.Meta.Package, req.appData)
	if err != nil {
		return SessionView{}, err
	}
	ref := artifactRef(req.source, artifact.ID, artifact.Revision)
	var webviewVersion string
	if webview != nil {
		webviewVersion = webview.Version
	}
	recTarget, rec := s.recordingFor(ctx, who, req.record, contract.Session{
		Package: entry.Meta.Package, ArtifactRef: ref, Location: req.location, WebView: webviewVersion,
	})
	line := req.provider
	if req.slot != "" {
		line += "/" + req.slot
	}
	var target launchTarget
	var sess contract.Session
	err = s.queue.run(ctx, line, req.queue, func() error {
		var err error
		if target, err = s.pickSlot(ctx, candidates, req.slot, restore != nil); err != nil {
			return err
		}
		sess, err = s.providers[target.provider].Create(context.WithoutCancel(ctx), contract.CreateSession{
			ArtifactURL: s.artifactURL(entry.Key),
			ArtifactRef: ref,
			Package:     entry.Meta.Package,
			Owner:       who.User,
			Location:    req.location,
			Slot:        target.slot,
			Screen:      req.screen,
			Android:     req.android,
			AppData:     restore,
			SaveAppData: req.saveAppData && s.appData != nil,
			WebView:     webview,
			Frontend:    validFrontend(artifact.Meta.Tags["frontend"]),
			Recording:   recTarget,
			Route:       s.cachedRoute(ctx, target.provider, req.location),
			DarkMode:    req.darkMode,
			ImageScan:   req.imageScan,
		})
		return err
	})
	if err != nil {
		if recTarget != nil {
			_ = s.recordings.remove(context.WithoutCancel(ctx), recordingRef{userDir(rec.Owner), rec.ID})
		}
		return SessionView{}, err
	}
	ctx = context.WithoutCancel(ctx)
	details := map[string]string{"package": entry.Meta.Package, "location": req.location, "slot": sess.Slot}
	if restore != nil {
		s.markAppDataUsed(ctx, snapshot)
		details["appData"], details["appDataCache"] = snapshot.ID, strconv.FormatBool(restore.Cache)
	}
	if webview != nil {
		details["webview"] = webview.Version
	}
	if recTarget != nil {
		rec.Provider, rec.Session, rec.Location = target.provider, sess.ID, sess.Location
		if err := s.writeRecordingMeta(ctx, rec); err != nil {
			s.log.Warn("could not note the recording's session", "recording", rec.ID, "err", err)
		}
		details["recording"] = rec.ID
	}
	k := sessionKey{target.provider, sess.ID}
	s.activity.Mark(k)
	s.launches.add(k, s.now())
	s.markUsed(ctx, req.source, artifact)
	s.emit(ctx, audit.Event{Action: audit.SessionLaunch, Provider: target.provider, Session: sess.ID, Artifact: ref, Details: details})
	s.log.Info("session created", "provider", target.provider, "session", sess.ID, "slot", sess.Slot, "owner", who.User, "package", entry.Meta.Package)
	return s.view(ctx, target.provider, sess), nil
}

func (s *Server) offering(ctx context.Context, names []string, location string) []string {
	var out []string
	for _, name := range names {
		caps, err := s.providers[name].Capabilities(ctx)
		if err == nil && slices.ContainsFunc(caps.Locations, func(l contract.Location) bool { return l.ID == location }) {
			out = append(out, name)
		}
	}
	return out
}

// pickSlot finds a free slot among the providers in order. Given a slot, only
// that one counts. Restoring app data prefers devices that can do it, and
// skips the others unless only one provider was asked for.
func (s *Server) pickSlot(ctx context.Context, names []string, slot string, appData bool) (launchTarget, error) {
	fits := func(sl contract.Slot) bool {
		return sl.State == contract.SlotFree && (!appData || sl.Capabilities == nil || sl.Capabilities.AppData)
	}
	var fallback *launchTarget
	var lastErr error
	for _, name := range names {
		c, err := s.providers[name].Capacity(ctx)
		if err != nil {
			lastErr = err
			continue
		}
		if slot != "" {
			i, err := c.Pick(slot)
			if err != nil {
				return launchTarget{}, err
			}
			return launchTarget{name, c.Slots[i].ID}, nil
		}
		if i := slices.IndexFunc(c.Slots, fits); i >= 0 {
			return launchTarget{name, c.Slots[i].ID}, nil
		}
		if i, err := c.Pick(""); err == nil && len(names) == 1 {
			fallback = &launchTarget{name, c.Slots[i].ID}
		}
	}
	switch {
	case fallback != nil:
		return *fallback, nil
	case lastErr != nil && len(names) == 1:
		return launchTarget{}, lastErr
	}
	return launchTarget{}, contract.ErrNoCapacity
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
