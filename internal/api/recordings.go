package api

import (
	"bytes"
	"cmp"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"golang.org/x/sync/errgroup"

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/storage"
)

// recordingsPrefix holds recordings in the shared store; a dedicated
// recordings.storage keeps them at the root.
const recordingsPrefix = "recordings/"

const (
	recordingStale  = 2 * time.Minute
	recordingUnseen = 15 * time.Minute
	recordingCache  = time.Minute
)

var (
	recordingID = regexp.MustCompile(`^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{24}$`)
	userHash    = regexp.MustCompile(`^[0-9a-f]{32}$`)
	shareToken  = regexp.MustCompile(`^[0-9a-f]{32}$`)

	errRecordingsDisabled = errors.New("recordings are turned off on this server")
	errSharingDisabled    = errors.New("sharing recordings is turned off on this server")
	errQuota              = errors.New("the recording storage quota is used up")
	errRecordAlways       = errors.New("this server records every session and a recording can't be stopped")
)

// recordingMeta is what the api knows of a recording when it starts; it is
// written before the agent uploads anything and only by the api.
type recordingMeta struct {
	ID          string    `json:"id"`
	Owner       string    `json:"owner"`
	Provider    string    `json:"provider"`
	Session     string    `json:"session"`
	Package     string    `json:"package"`
	ArtifactRef string    `json:"artifactRef"`
	Label       string    `json:"label,omitempty"`
	Title       string    `json:"title,omitempty"`
	VersionName string    `json:"versionName,omitempty"`
	VersionCode int32     `json:"versionCode,omitempty"`
	Location    string    `json:"location,omitempty"`
	WebView     string    `json:"webview,omitempty"`
	Icon        bool      `json:"icon,omitempty"`
	Secret      string    `json:"secret" doc:"SHA-256 of the upload secret"`
	CreatedAt   time.Time `json:"createdAt"`
}

// recordingState is the summary of the agent's latest manifest, written
// only by the upload handler.
type recordingState struct {
	State     contract.RecordingStatus `json:"state"`
	Reason    string                   `json:"reason,omitempty"`
	StartedAt time.Time                `json:"startedAt"`
	UpdatedAt time.Time                `json:"updatedAt"`
	Duration  int64                    `json:"duration"`
	Size      int64                    `json:"size"`
	Thumbnail bool                     `json:"thumbnail,omitempty"`
}

// recordingStore lays recordings out as
//
//	meta/<user>/<id>.json        recordingMeta
//	meta/<user>/<id>.state.json  recordingState
//	meta/<user>/<id>.keep        kept past recordings.maxAge
//	meta/<user>/<id>.share       the share token
//	files/<user>/<id>/<file>     the agent's uploads and icon.png
//	shares/<token>.json          the recording a share token opens
//
// so a user's recordings are listed without their files.
type recordingStore struct {
	store  storage.Store
	prefix string

	mu    sync.Mutex
	metas map[string]cachedMeta
	usage map[string]cachedUsage
}

type cachedMeta struct {
	m  recordingMeta
	at time.Time
}

type cachedUsage struct {
	bytes int64
	at    time.Time
}

type recordingRef struct{ user, id string }

type shareIndex struct {
	User string `json:"user"`
	ID   string `json:"id"`
}

func newRecordingStore(store storage.Store, prefix string) *recordingStore {
	return &recordingStore{store: store, prefix: prefix, metas: map[string]cachedMeta{}, usage: map[string]cachedUsage{}}
}

func (r *recordingStore) metaDir(user string) string { return r.prefix + "meta/" + user + "/" }

func (r *recordingStore) metaKey(ref recordingRef, ext string) string {
	return r.metaDir(ref.user) + ref.id + ext
}

func (r *recordingStore) fileKey(ref recordingRef, name string) string {
	return r.prefix + "files/" + ref.user + "/" + ref.id + "/" + name
}

func (r *recordingStore) shareKey(token string) string { return r.prefix + "shares/" + token + ".json" }

func readJSON[T any](ctx context.Context, store storage.Store, key string) (T, error) {
	var v T
	rc, _, err := store.Get(ctx, key)
	if errors.Is(err, storage.ErrNotExist) {
		return v, contract.ErrNotFound
	}
	if err != nil {
		return v, err
	}
	defer rc.Close()
	err = json.NewDecoder(io.LimitReader(rc, 16<<20)).Decode(&v)
	return v, err
}

func writeJSON(ctx context.Context, store storage.Store, key string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return store.Put(ctx, key, bytes.NewReader(b), int64(len(b)))
}

func (r *recordingStore) exists(ctx context.Context, key string) bool {
	_, err := r.store.Stat(ctx, key)
	return err == nil
}

func (r *recordingStore) meta(ctx context.Context, ref recordingRef, now time.Time) (recordingMeta, error) {
	r.mu.Lock()
	c, ok := r.metas[ref.id]
	r.mu.Unlock()
	if ok && now.Sub(c.at) < recordingCache {
		return c.m, nil
	}
	m, err := readJSON[recordingMeta](ctx, r.store, r.metaKey(ref, ".json"))
	if err != nil {
		return m, err
	}
	r.mu.Lock()
	r.metas[ref.id] = cachedMeta{m, now}
	r.mu.Unlock()
	return m, nil
}

func (r *recordingStore) state(ctx context.Context, ref recordingRef) (*recordingState, error) {
	st, err := readJSON[recordingState](ctx, r.store, r.metaKey(ref, ".state.json"))
	if errors.Is(err, contract.ErrNotFound) {
		return nil, nil
	}
	return &st, err
}

type recordingEntry struct {
	ref   recordingRef
	meta  recordingMeta
	state *recordingState
	keep  bool
	share string
}

// list reads every recording of user; with user empty, only the keys.
func (r *recordingStore) list(ctx context.Context, user string) ([]*recordingEntry, error) {
	prefix := r.prefix + "meta/"
	if user != "" {
		prefix = r.metaDir(user)
	}
	objs, err := r.store.List(ctx, prefix)
	if err != nil {
		return nil, err
	}
	byID := map[recordingRef]*recordingEntry{}
	var order []*recordingEntry
	for _, o := range objs {
		rel := strings.TrimPrefix(o.Key, r.prefix+"meta/")
		u, name, ok := strings.Cut(rel, "/")
		if !ok || !userHash.MatchString(u) {
			continue
		}
		id, ext, _ := strings.Cut(name, ".")
		if !recordingID.MatchString(id) {
			continue
		}
		ref := recordingRef{u, id}
		e := byID[ref]
		if e == nil {
			e = &recordingEntry{ref: ref}
			byID[ref] = e
			order = append(order, e)
		}
		switch ext {
		case "keep":
			e.keep = true
		case "share":
			e.share = "?"
		case "state.json":
			e.state = &recordingState{}
		}
	}
	if user == "" {
		return order, nil
	}
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(16)
	for _, e := range order {
		g.Go(func() error {
			m, err := readJSON[recordingMeta](gctx, r.store, r.metaKey(e.ref, ".json"))
			if errors.Is(err, contract.ErrNotFound) {
				return nil
			}
			if err != nil {
				return err
			}
			e.meta = m
			if e.state != nil {
				if e.state, err = r.state(gctx, e.ref); err != nil {
					return err
				}
			}
			if e.share != "" {
				e.share = r.readShare(gctx, e.ref)
			}
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	return slices.DeleteFunc(order, func(e *recordingEntry) bool { return e.meta.ID == "" }), nil
}

func (r *recordingStore) readShare(ctx context.Context, ref recordingRef) string {
	rc, _, err := r.store.Get(ctx, r.metaKey(ref, ".share"))
	if err != nil {
		return ""
	}
	defer rc.Close()
	b, _ := io.ReadAll(io.LimitReader(rc, 64))
	if t := strings.TrimSpace(string(b)); shareToken.MatchString(t) {
		return t
	}
	return ""
}

func (r *recordingStore) remove(ctx context.Context, ref recordingRef) error {
	if t := r.readShare(ctx, ref); t != "" {
		_ = r.store.Delete(ctx, r.shareKey(t))
	}
	files, err := r.store.List(ctx, r.fileKey(ref, ""))
	if err != nil {
		return err
	}
	for _, f := range files {
		if err := r.store.Delete(ctx, f.Key); err != nil && !errors.Is(err, storage.ErrNotExist) {
			return err
		}
	}
	for _, ext := range []string{".share", ".keep", ".markers.json", ".state.json", ".json"} {
		if err := r.store.Delete(ctx, r.metaKey(ref, ext)); err != nil && !errors.Is(err, storage.ErrNotExist) {
			return err
		}
	}
	r.mu.Lock()
	delete(r.metas, ref.id)
	delete(r.usage, ref.user)
	r.mu.Unlock()
	return nil
}

func recordingCreated(id string) time.Time {
	t, _ := time.Parse("20060102T150405Z", id[:16])
	return t
}

func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

// status is what a recording shows as: one whose agent stopped reporting
// is interrupted, one that never started is pending until it is given up.
func (s *Server) recordingStatus(e *recordingEntry) string {
	now := s.now()
	switch {
	case e.state == nil && now.Sub(e.meta.CreatedAt) > recordingUnseen:
		return string(contract.RecordingInterrupted)
	case e.state == nil:
		return "pending"
	case e.state.State == contract.RecordingActive && now.Sub(e.state.UpdatedAt) > recordingStale:
		return string(contract.RecordingInterrupted)
	}
	return string(e.state.State)
}

func (s *Server) recordingExpires(e *recordingEntry) (time.Time, bool) {
	if e.keep || s.cfg.Recordings.MaxAge <= 0 {
		return time.Time{}, false
	}
	return e.meta.CreatedAt.Add(s.cfg.Recordings.MaxAge), true
}

func (s *Server) recordingExpired(e *recordingEntry) bool {
	at, ok := s.recordingExpires(e)
	return ok && !s.now().Before(at)
}

// usage is how many bytes user's recordings take, computed at most once a
// minute per replica.
func (s *Server) recordingUsage(ctx context.Context, user string) (int64, []*recordingEntry, error) {
	entries, err := s.recordings.list(ctx, user)
	if err != nil {
		return 0, nil, err
	}
	var total int64
	for _, e := range entries {
		if e.state != nil {
			total += e.state.Size
		}
	}
	s.recordings.mu.Lock()
	s.recordings.usage[user] = cachedUsage{total, s.now()}
	s.recordings.mu.Unlock()
	return total, entries, nil
}

// makeRoom deletes user's oldest recordings that are neither kept nor
// running until need more bytes fit the quota, and reports whether they do.
func (s *Server) makeRoom(ctx context.Context, user string, quota, need int64, except string) (bool, error) {
	if quota <= 0 {
		return true, nil
	}
	used, entries, err := s.recordingUsage(ctx, user)
	if err != nil {
		return false, err
	}
	slices.SortFunc(entries, func(a, b *recordingEntry) int { return strings.Compare(a.ref.id, b.ref.id) })
	for _, e := range entries {
		if used+need <= quota {
			break
		}
		if e.ref.id == except || e.keep || e.state == nil || s.recordingStatus(e) == string(contract.RecordingActive) {
			continue
		}
		if err := s.recordings.remove(ctx, e.ref); err != nil {
			return false, err
		}
		used -= e.state.Size
		s.log.Info("recording deleted to make room", "owner", e.meta.Owner, "recording", e.ref.id)
	}
	s.recordings.mu.Lock()
	s.recordings.usage[user] = cachedUsage{used, s.now()}
	s.recordings.mu.Unlock()
	return used+need <= quota, nil
}

// newRecording writes the meta of a recording of a session about to start
// (sess has no ID yet) and returns where its agent uploads.
func (s *Server) newRecording(ctx context.Context, who auth.Identity, sess contract.Session, provider string) (*contract.RecordingTarget, recordingMeta, error) {
	user := userDir(who.User)
	if ok, err := s.makeRoom(ctx, user, s.limits(ctx, who.User).RecordingsQuota, 0, ""); err != nil || !ok {
		return nil, recordingMeta{}, cmp.Or(err, errQuota)
	}
	now := s.now().UTC()
	secret := randomHex(24)
	m := recordingMeta{
		ID: newAppDataID(now), Owner: who.User, Provider: provider, Session: sess.ID, Package: sess.Package,
		ArtifactRef: sess.ArtifactRef, Location: sess.Location, WebView: sess.WebView, Secret: hashSecret(secret), CreatedAt: now,
	}
	srcName, key, rev := splitRef(sess.ArtifactRef)
	if e, ok := s.cache.Lookup(ctx, srcName, key, rev); ok {
		m.Label, m.VersionName, m.VersionCode = e.Meta.Label, e.Meta.VersionName, e.Meta.VersionCode
		if e.HasIcon {
			if icon, err := s.cache.Icon(ctx, e.Key); err == nil {
				ref := recordingRef{user, m.ID}
				m.Icon = s.recordings.store.Put(ctx, s.recordings.fileKey(ref, "icon.png"), bytes.NewReader(icon), int64(len(icon))) == nil
			}
		}
	}
	if err := s.writeRecordingMeta(ctx, m); err != nil {
		return nil, m, err
	}
	url := strings.TrimRight(s.cfg.InternalURL, "/") + "/internal/recordings/" + user + "/" + m.ID + "/" + secret
	return &contract.RecordingTarget{ID: m.ID, URL: url}, m, nil
}

func (s *Server) writeRecordingMeta(ctx context.Context, m recordingMeta) error {
	ref := recordingRef{userDir(m.Owner), m.ID}
	if err := writeJSON(ctx, s.recordings.store, s.recordings.metaKey(ref, ".json"), m); err != nil {
		return err
	}
	s.recordings.mu.Lock()
	s.recordings.metas[m.ID] = cachedMeta{m, s.now()}
	s.recordings.mu.Unlock()
	return nil
}

// recordingFor creates the recording a launch asks for, if any; a full
// quota launches the session without one.
func (s *Server) recordingFor(ctx context.Context, who auth.Identity, record *bool, sess contract.Session) (*contract.RecordingTarget, recordingMeta) {
	var want bool
	switch s.cfg.Recordings.Mode {
	case RecordAlways:
		want = true
	case RecordAuto:
		want = record == nil || *record
	default:
		want = record != nil && *record
	}
	if s.recordings == nil || !want {
		return nil, recordingMeta{}
	}
	target, m, err := s.newRecording(ctx, who, sess, "")
	if err != nil {
		s.log.Warn("launching without a recording", "owner", who.User, "err", err)
		return nil, recordingMeta{}
	}
	return target, m
}

func (s *Server) agentClient(ctx context.Context, provider string, id string) (*contract.AgentClient, error) {
	p, err := s.provider(provider)
	if err != nil {
		return nil, err
	}
	u, err := s.agents.get(ctx, sessionKey{provider, id}, p)
	if err != nil {
		return nil, err
	}
	return contract.NewAgentClient(u.String(), &http.Client{Transport: s.agentTransport}), nil
}

// stopRecording asks a session's agent to finish its recording before the
// session goes away; the agent also finishes on its own when it is stopped.
func (s *Server) stopRecording(ctx context.Context, provider string, sess contract.Session) {
	if s.recordings == nil || sess.State != contract.StateReady {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	c, err := s.agentClient(ctx, provider, sess.ID)
	if err != nil {
		return
	}
	if st, err := c.StopRecording(ctx); err != nil {
		s.log.Warn("could not stop the recording", "provider", provider, "session", sess.ID, "err", err)
	} else if st.ID != "" && st.Active {
		s.log.Warn("the recording is still uploading", "provider", provider, "session", sess.ID, "recording", st.ID)
	}
}

// serveRecordingUpload takes a file from a recording agent. The manifest
// updates the recording's state and checks the owner's quota.
func (s *Server) serveRecordingUpload(w http.ResponseWriter, r *http.Request) {
	ref := recordingRef{r.PathValue("user"), r.PathValue("id")}
	name := r.PathValue("file")
	if s.recordings == nil || !userHash.MatchString(ref.user) || !recordingID.MatchString(ref.id) || !contract.RecordingFile(name) {
		http.NotFound(w, r)
		return
	}
	ctx := r.Context()
	m, err := s.recordings.meta(ctx, ref, s.now())
	if err != nil || userDir(m.Owner) != ref.user || subtle.ConstantTimeCompare([]byte(hashSecret(r.PathValue("secret"))), []byte(m.Secret)) != 1 {
		http.NotFound(w, r)
		return
	}
	limit := int64(s.cfg.Recordings.MaxFileSize)
	if r.ContentLength > limit {
		http.Error(w, "file too large", http.StatusRequestEntityTooLarge)
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if name == "manifest.json" {
		if code, err := s.takeManifest(ctx, ref, m, data); err != nil {
			http.Error(w, err.Error(), code)
			return
		}
	}
	if err := s.recordings.store.Put(ctx, s.recordings.fileKey(ref, name), bytes.NewReader(data), int64(len(data))); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if name == "manifest.json" {
		var mf contract.RecordingManifest
		if json.Unmarshal(data, &mf) == nil && mf.State != contract.RecordingActive {
			s.dropIfTooShort(ctx, ref, mf.Duration)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// dropIfTooShort deletes a recording that ended before recordings.minDuration,
// unless it was kept (sharing keeps it) or has a marker, which says someone
// wanted it.
func (s *Server) dropIfTooShort(ctx context.Context, ref recordingRef, duration int64) bool {
	min := s.cfg.Recordings.MinDuration
	if min <= 0 || time.Duration(duration)*time.Millisecond >= min {
		return false
	}
	if s.recordings.exists(ctx, s.recordings.metaKey(ref, ".keep")) || len(s.recordings.markers(ctx, ref)) > 0 {
		return false
	}
	if err := s.recordings.remove(context.WithoutCancel(ctx), ref); err != nil {
		s.log.Warn("could not delete a recording that is too short", "recording", ref.id, "err", err)
		return false
	}
	s.log.Info("recording deleted: shorter than recordings.minDuration", "recording", ref.id, "duration", time.Duration(duration)*time.Millisecond)
	return true
}

func (s *Server) takeManifest(ctx context.Context, ref recordingRef, m recordingMeta, data []byte) (int, error) {
	var mf contract.RecordingManifest
	if err := json.Unmarshal(data, &mf); err != nil {
		return http.StatusBadRequest, err
	}
	if quota := s.limits(ctx, m.Owner).RecordingsQuota; quota > 0 && mf.State == contract.RecordingActive {
		s.recordings.mu.Lock()
		u, fresh := s.recordings.usage[ref.user]
		s.recordings.mu.Unlock()
		prev, _ := s.recordings.state(ctx, ref)
		grown := mf.Size
		if prev != nil {
			grown -= prev.Size
		}
		if !fresh || s.now().Sub(u.at) > recordingCache || u.bytes+grown > quota {
			ok, err := s.makeRoom(ctx, ref.user, quota, grown, ref.id)
			if err != nil {
				return http.StatusInternalServerError, err
			}
			if !ok {
				mf.State, mf.Reason = contract.RecordingFailed, errQuota.Error()
				_ = s.writeState(ctx, ref, mf)
				s.log.Info("recording stopped by the quota", "owner", m.Owner, "recording", ref.id)
				return http.StatusInsufficientStorage, errQuota
			}
		} else {
			s.recordings.mu.Lock()
			s.recordings.usage[ref.user] = cachedUsage{u.bytes + grown, u.at}
			s.recordings.mu.Unlock()
		}
	}
	if err := s.writeState(ctx, ref, mf); err != nil {
		return http.StatusInternalServerError, err
	}
	return 0, nil
}

func (s *Server) writeState(ctx context.Context, ref recordingRef, mf contract.RecordingManifest) error {
	return writeJSON(ctx, s.recordings.store, s.recordings.metaKey(ref, ".state.json"), recordingState{
		State: mf.State, Reason: mf.Reason, StartedAt: mf.StartedAt, UpdatedAt: mf.UpdatedAt,
		Duration: mf.Duration, Size: mf.Size, Thumbnail: mf.Thumbnail != "",
	})
}

// sweepRecordings deletes expired recordings and ones that never started.
func (s *Server) sweepRecordings(ctx context.Context) {
	entries, err := s.recordings.list(ctx, "")
	if err != nil {
		s.log.Warn("recording retention: list failed", "err", err)
		return
	}
	for _, e := range entries {
		created := recordingCreated(e.ref.id)
		e.meta.CreatedAt = created
		if e.state != nil && s.now().Sub(created) < 2*time.Hour {
			if st, err := s.recordings.state(ctx, e.ref); err == nil && st != nil {
				e.state = st
				switch s.recordingStatus(e) {
				case string(contract.RecordingDone), string(contract.RecordingFailed), string(contract.RecordingInterrupted):
					if s.dropIfTooShort(ctx, e.ref, st.Duration) {
						continue
					}
				}
			}
		}
		never := e.state == nil && s.now().Sub(created) > time.Hour
		if !never && !s.recordingExpired(e) {
			continue
		}
		if err := s.recordings.remove(ctx, e.ref); err != nil {
			s.log.Warn("recording retention: delete failed", "recording", e.ref.id, "err", err)
			continue
		}
		s.log.Info("recording deleted by retention", "recording", e.ref.id)
	}
}

func (s *Server) recordingsLoop(ctx context.Context) {
	tick := time.NewTicker(s.cfg.Recordings.SweepInterval)
	defer tick.Stop()
	for {
		s.sweepRecordings(ctx)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

type RecordingShare struct {
	Token string `json:"token"`
	URL   string `json:"url"`
}

type RecordingView struct {
	ID           string          `json:"id"`
	Owner        string          `json:"owner,omitempty"`
	Package      string          `json:"package"`
	Label        string          `json:"label,omitempty"`
	Title        string          `json:"title,omitempty" doc:"the name the owner gave the recording, shown instead of the app's"`
	VersionName  string          `json:"versionName,omitempty"`
	VersionCode  int32           `json:"versionCode,omitempty"`
	Source       string          `json:"source"`
	ArtifactID   string          `json:"artifactId"`
	Provider     string          `json:"provider,omitempty"`
	Session      string          `json:"session,omitempty"`
	Location     string          `json:"location,omitempty"`
	WebView      string          `json:"webview,omitempty"`
	State        string          `json:"state" enum:"pending,recording,done,failed,interrupted"`
	Reason       string          `json:"reason,omitempty"`
	CreatedAt    time.Time       `json:"createdAt"`
	StartedAt    time.Time       `json:"startedAt,omitzero"`
	Duration     int64           `json:"duration" doc:"milliseconds"`
	Size         int64           `json:"size" doc:"bytes stored"`
	FilesURL     string          `json:"filesUrl" doc:"prefix of the recording's files: manifest.json and what it lists"`
	IconURL      string          `json:"iconUrl,omitempty"`
	ThumbnailURL string          `json:"thumbnailUrl,omitempty"`
	LogcatURL    string          `json:"logcatUrl" doc:"the whole logcat as one text file"`
	LogcatLogURL string          `json:"logcatLogUrl" doc:"the whole logcat as a .log with ANSI colours by level"`
	ExportURL    string          `json:"exportUrl" doc:"every file of the recording as one .holtdroid archive, which the portal plays from disk"`
	Keep         bool            `json:"keep" doc:"kept past the retention period"`
	ExpiresAt    *time.Time      `json:"expiresAt,omitempty"`
	Share        *RecordingShare `json:"share,omitempty"`
}

type RecordingList struct {
	Enabled     bool            `json:"enabled"`
	Mode        string          `json:"mode" enum:"always,auto,manual" doc:"always: every session is recorded and it can't be stopped; auto: recorded unless the launch says no; manual: only when asked"`
	Share       bool            `json:"share" doc:"recordings can be shared by link"`
	Quota       int64           `json:"quota" doc:"bytes a user's recordings may take, 0 for no limit"`
	Used        int64           `json:"used" doc:"bytes the caller's recordings take"`
	MaxAge      int64           `json:"maxAge" doc:"seconds a recording is kept unless it is kept for longer, 0 for no limit"`
	MinDuration int64           `json:"minDuration" doc:"seconds: a finished recording shorter than this is deleted, unless it is kept or has a marker; 0 keeps them all"`
	Items       []RecordingView `json:"items"`
}

type RecordingDetail struct {
	Recording RecordingView               `json:"recording"`
	Markers   []RecordingMarker           `json:"markers" doc:"pins on the timeline"`
	Manifest  *contract.RecordingManifest `json:"manifest,omitempty" doc:"absent until the agent uploads its first one"`
	Shared    bool                        `json:"shared" doc:"opened through a share link"`
}

func (s *Server) recordingView(ctx context.Context, e *recordingEntry, base string) RecordingView {
	m := e.meta
	srcName, key, rev := splitRef(m.ArtifactRef)
	v := RecordingView{
		ID: m.ID, Package: m.Package, Label: m.Label, Title: m.Title, VersionName: m.VersionName, VersionCode: m.VersionCode,
		Source: srcName, ArtifactID: encodeID(key), Provider: m.Provider, Session: m.Session,
		Location: m.Location, WebView: m.WebView, State: s.recordingStatus(e), CreatedAt: m.CreatedAt,
		FilesURL: base + "files/", LogcatURL: base + "logcat.txt", LogcatLogURL: base + "logcat.log", ExportURL: base + "export", Keep: e.keep,
	}
	if e, ok := s.cache.Lookup(ctx, srcName, key, rev); ok && v.Label == "" {
		v.Label = e.Meta.Label
	}
	if m.Icon {
		v.IconURL = v.FilesURL + "icon.png"
	}
	if st := e.state; st != nil {
		v.Reason, v.StartedAt, v.Duration, v.Size = st.Reason, st.StartedAt, st.Duration, st.Size
		if v.State == string(contract.RecordingActive) {
			v.Duration = max(v.Duration, s.now().Sub(st.StartedAt).Milliseconds())
		}
		if st.Thumbnail {
			v.ThumbnailURL = v.FilesURL + "thumb.jpg?v=" + strconv.FormatInt(st.UpdatedAt.Unix()/60, 10)
		}
	}
	if at, ok := s.recordingExpires(e); ok {
		v.ExpiresAt = &at
	}
	if e.share != "" && s.cfg.Recordings.Share {
		v.Share = &RecordingShare{Token: e.share, URL: strings.TrimRight(s.cfg.PublicURL, "/") + "/r/" + e.share}
	}
	return v
}

func ownBase(id string) string { return "/api/v1/recordings/" + id + "/" }

func sharedBase(token string) string { return "/api/v1/shared/" + token + "/" }

// entry reads one recording with its state and markers.
func (s *Server) recordingEntry(ctx context.Context, ref recordingRef) (*recordingEntry, error) {
	m, err := readJSON[recordingMeta](ctx, s.recordings.store, s.recordings.metaKey(ref, ".json"))
	if err != nil {
		return nil, err
	}
	e := &recordingEntry{ref: ref, meta: m}
	if e.state, err = s.recordings.state(ctx, ref); err != nil {
		return nil, err
	}
	e.keep = s.recordings.exists(ctx, s.recordings.metaKey(ref, ".keep"))
	e.share = s.recordings.readShare(ctx, ref)
	return e, nil
}

func (s *Server) ownRecording(ctx context.Context, id string) (*recordingEntry, error) {
	if s.recordings == nil {
		return nil, errRecordingsDisabled
	}
	if !recordingID.MatchString(id) {
		return nil, fmt.Errorf("%w: recording %s", contract.ErrNotFound, id)
	}
	who, _ := auth.FromContext(ctx)
	return s.recordingEntry(ctx, recordingRef{userDir(who.User), id})
}

func (s *Server) sharedRecording(ctx context.Context, token string) (*recordingEntry, error) {
	if s.recordings == nil || !s.cfg.Recordings.Share || !shareToken.MatchString(token) {
		return nil, fmt.Errorf("%w: share link", contract.ErrNotFound)
	}
	idx, err := readJSON[shareIndex](ctx, s.recordings.store, s.recordings.shareKey(token))
	if err != nil {
		return nil, err
	}
	e, err := s.recordingEntry(ctx, recordingRef{idx.User, idx.ID})
	if err != nil || e.share != token {
		return nil, fmt.Errorf("%w: share link", contract.ErrNotFound)
	}
	return e, nil
}

func (s *Server) recordingDetail(ctx context.Context, e *recordingEntry, base string, shared bool) RecordingDetail {
	d := RecordingDetail{Recording: s.recordingView(ctx, e, base), Markers: s.recordings.markers(ctx, e.ref), Shared: shared}
	if shared {
		d.Recording.Share, d.Recording.Provider, d.Recording.Session = nil, "", ""
		d.Recording.Owner = e.meta.Owner
	}
	if mf, err := readJSON[contract.RecordingManifest](ctx, s.recordings.store, s.recordings.fileKey(e.ref, "manifest.json")); err == nil {
		d.Manifest = &mf
	}
	return d
}

type RecordingEvents struct {
	Items []contract.RecordingEvent `json:"items"`
}

func (s *Server) recordingEvents(ctx context.Context, e *recordingEntry) (*out[RecordingEvents], error) {
	l := RecordingEvents{Items: []contract.RecordingEvent{}}
	mf, err := readJSON[contract.RecordingManifest](ctx, s.recordings.store, s.recordings.fileKey(e.ref, "manifest.json"))
	if errors.Is(err, contract.ErrNotFound) {
		return &out[RecordingEvents]{l}, nil
	}
	if err != nil {
		return nil, httpError(err)
	}
	for _, c := range mf.Events {
		if !contract.RecordingFile(c.File) {
			continue
		}
		rc, _, err := s.recordings.store.Get(ctx, s.recordings.fileKey(e.ref, c.File))
		if err != nil {
			continue
		}
		if zr, err := gzip.NewReader(rc); err == nil {
			dec := json.NewDecoder(zr)
			for {
				var ev contract.RecordingEvent
				if dec.Decode(&ev) != nil {
					break
				}
				l.Items = append(l.Items, ev)
			}
		}
		rc.Close()
	}
	return &out[RecordingEvents]{l}, nil
}

type recordingPath struct {
	ID string `path:"id"`
}

type sharePath struct {
	Token string `path:"token"`
}

type renameInput struct {
	ID   string `path:"id"`
	Body struct {
		Name string `json:"name" maxLength:"120"`
	}
}

type keepInput struct {
	ID   string `path:"id"`
	Body struct {
		Keep bool `json:"keep"`
	}
}

func (s *Server) registerRecordings(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "listRecordings", Method: http.MethodGet, Path: "/api/v1/recordings", Tags: tags,
		Description: "The caller's session recordings, newest first, and the server's rules for them.",
	}, func(ctx context.Context, _ *struct{}) (*out[RecordingList], error) {
		cfg := s.cfg.Recordings
		l := RecordingList{Items: []RecordingView{}}
		if s.recordings == nil {
			return &out[RecordingList]{l}, nil
		}
		who, _ := auth.FromContext(ctx)
		l.Enabled, l.Mode, l.Share, l.Quota, l.MaxAge = true, cfg.Mode, cfg.Share, s.limits(ctx, who.User).RecordingsQuota, int64(cfg.MaxAge/time.Second)
		l.MinDuration = int64(cfg.MinDuration / time.Second)
		used, entries, err := s.recordingUsage(ctx, userDir(who.User))
		if err != nil {
			return nil, httpError(err)
		}
		l.Used = used
		for _, e := range entries {
			v := s.recordingView(ctx, e, ownBase(e.ref.id))
			if e.meta.Owner != who.User || s.recordingExpired(e) || v.State == string(contract.RecordingInterrupted) && e.state == nil {
				continue
			}
			l.Items = append(l.Items, v)
		}
		slices.SortFunc(l.Items, func(a, b RecordingView) int { return strings.Compare(b.ID, a.ID) })
		return &out[RecordingList]{l}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "getRecording", Method: http.MethodGet, Path: "/api/v1/recordings/{id}", Tags: tags},
		func(ctx context.Context, in *recordingPath) (*out[RecordingDetail], error) {
			e, err := s.ownRecording(ctx, in.ID)
			if err != nil {
				return nil, httpError(err)
			}
			return &out[RecordingDetail]{s.recordingDetail(ctx, e, ownBase(in.ID), false)}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "getSharedRecording", Method: http.MethodGet, Path: "/api/v1/shared/{token}", Tags: tags,
		Description: "A recording opened through a share link; needs no sign-in.",
	}, func(ctx context.Context, in *sharePath) (*out[RecordingDetail], error) {
		e, err := s.sharedRecording(ctx, in.Token)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[RecordingDetail]{s.recordingDetail(ctx, e, sharedBase(in.Token), true)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "getRecordingEvents", Method: http.MethodGet, Path: "/api/v1/recordings/{id}/events", Tags: tags,
		Description: "Every event of the recording, from all its event files, in order.",
	}, func(ctx context.Context, in *recordingPath) (*out[RecordingEvents], error) {
		e, err := s.ownRecording(ctx, in.ID)
		if err != nil {
			return nil, httpError(err)
		}
		return s.recordingEvents(ctx, e)
	})

	huma.Register(api, huma.Operation{
		OperationID: "getSharedRecordingEvents", Method: http.MethodGet, Path: "/api/v1/shared/{token}/events", Tags: tags,
	}, func(ctx context.Context, in *sharePath) (*out[RecordingEvents], error) {
		e, err := s.sharedRecording(ctx, in.Token)
		if err != nil {
			return nil, httpError(err)
		}
		return s.recordingEvents(ctx, e)
	})

	s.registerMarkers(api)

	huma.Register(api, huma.Operation{
		OperationID: "renameRecording", Method: http.MethodPut, Path: "/api/v1/recordings/{id}/name", Tags: tags,
		Description: "Names the recording; an empty name goes back to the app's.",
	}, func(ctx context.Context, in *renameInput) (*out[RecordingView], error) {
		ev := audit.Event{Action: audit.RecordingRename, Details: map[string]string{"recording": in.ID}}
		e, err := s.ownRecording(ctx, in.ID)
		if err == nil {
			ev.Artifact, ev.Session = e.meta.ArtifactRef, e.meta.Session
			e.meta.Title = strings.Join(strings.Fields(in.Body.Name), " ")
			err = s.writeRecordingMeta(ctx, e.meta)
		}
		s.emitResult(ctx, ev, err)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[RecordingView]{s.recordingView(ctx, e, ownBase(in.ID))}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "keepRecording", Method: http.MethodPut, Path: "/api/v1/recordings/{id}/keep", Tags: tags,
		Description: "Keeps the recording past recordings.maxAge, or lets retention delete it again. It still counts against the quota.",
	}, func(ctx context.Context, in *keepInput) (*out[RecordingView], error) {
		e, err := s.ownRecording(ctx, in.ID)
		if err != nil {
			return nil, httpError(err)
		}
		key := s.recordings.metaKey(e.ref, ".keep")
		if in.Body.Keep {
			err = s.recordings.store.Put(ctx, key, strings.NewReader("1"), 1)
		} else if err = s.recordings.store.Delete(ctx, key); errors.Is(err, storage.ErrNotExist) {
			err = nil
		}
		if err != nil {
			return nil, httpError(err)
		}
		e.keep = in.Body.Keep
		return &out[RecordingView]{s.recordingView(ctx, e, ownBase(in.ID))}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "deleteRecording", Method: http.MethodDelete, Path: "/api/v1/recordings/{id}", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *recordingPath) (*struct{}, error) {
		ev := audit.Event{Action: audit.RecordingDelete, Details: map[string]string{"recording": in.ID}}
		e, err := s.ownRecording(ctx, in.ID)
		if err == nil {
			ev.Artifact, ev.Session = e.meta.ArtifactRef, e.meta.Session
			err = s.recordings.remove(ctx, e.ref)
		}
		s.emitResult(ctx, ev, err)
		return nil, httpError(err)
	})

	huma.Register(api, huma.Operation{
		OperationID: "shareRecording", Method: http.MethodPost, Path: "/api/v1/recordings/{id}/share", Tags: tags,
		Description: "Makes a link that opens the recording without signing in; asking again returns the same link. A shared recording is kept, so the link outlives recordings.maxAge.",
	}, func(ctx context.Context, in *recordingPath) (*out[RecordingView], error) {
		ev := audit.Event{Action: audit.RecordingShare, Details: map[string]string{"recording": in.ID}}
		e, err := s.ownRecording(ctx, in.ID)
		if err == nil && !s.cfg.Recordings.Share {
			err = errSharingDisabled
		}
		if err == nil && e.share == "" {
			e.share = randomHex(16)
			err = writeJSON(ctx, s.recordings.store, s.recordings.shareKey(e.share), shareIndex{User: e.ref.user, ID: e.ref.id})
			if err == nil {
				err = s.recordings.store.Put(ctx, s.recordings.metaKey(e.ref, ".share"), strings.NewReader(e.share), int64(len(e.share)))
			}
		}
		if err == nil && !e.keep {
			if err = s.recordings.store.Put(ctx, s.recordings.metaKey(e.ref, ".keep"), strings.NewReader("1"), 1); err == nil {
				e.keep = true
			}
		}
		if e != nil {
			ev.Artifact, ev.Session = e.meta.ArtifactRef, e.meta.Session
		}
		s.emitResult(ctx, ev, err)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[RecordingView]{s.recordingView(ctx, e, ownBase(in.ID))}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "unshareRecording", Method: http.MethodDelete, Path: "/api/v1/recordings/{id}/share", Tags: tags,
		Description: "Turns the recording's share link off.",
	}, func(ctx context.Context, in *recordingPath) (*out[RecordingView], error) {
		ev := audit.Event{Action: audit.RecordingUnshare, Details: map[string]string{"recording": in.ID}}
		e, err := s.ownRecording(ctx, in.ID)
		if err == nil && e.share != "" {
			_ = s.recordings.store.Delete(ctx, s.recordings.shareKey(e.share))
			if err = s.recordings.store.Delete(ctx, s.recordings.metaKey(e.ref, ".share")); errors.Is(err, storage.ErrNotExist) {
				err = nil
			}
			e.share = ""
		}
		s.emitResult(ctx, ev, err)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[RecordingView]{s.recordingView(ctx, e, ownBase(in.ID))}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "startSessionRecording", Method: http.MethodPost, Path: "/api/v1/sessions/{provider}/{id}/recording", Tags: tags,
		Description: "Starts recording the session into a new recording; 423 while one is in progress.",
	}, func(ctx context.Context, in *sessionPath) (*out[RecordingView], error) {
		if s.recordings == nil {
			return nil, httpError(errRecordingsDisabled)
		}
		ev := audit.Event{Action: audit.RecordingStart, Provider: in.Provider, Session: in.ID}
		v, err := s.startRecording(ctx, in.Provider, in.ID, &ev)
		s.emitResult(ctx, ev, err)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[RecordingView]{v}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "stopSessionRecording", Method: http.MethodDelete, Path: "/api/v1/sessions/{provider}/{id}/recording", Tags: tags,
		DefaultStatus: http.StatusNoContent, Description: "Stops the session's recording and waits for its last files.",
	}, func(ctx context.Context, in *sessionPath) (*struct{}, error) {
		ev := audit.Event{Action: audit.RecordingStop, Provider: in.Provider, Session: in.ID}
		_, sess, err := s.ownedSession(ctx, in.Provider, in.ID)
		if err == nil && s.cfg.Recordings.Mode == RecordAlways {
			err = errRecordAlways
		}
		var c *contract.AgentClient
		if err == nil {
			ev.Artifact = sess.ArtifactRef
			c, err = s.agentClient(ctx, in.Provider, in.ID)
		}
		if err == nil {
			var st contract.RecordingState
			if st, err = c.StopRecording(ctx); err == nil {
				ev.Details = map[string]string{"recording": st.ID}
			}
		}
		s.emitResult(ctx, ev, err)
		return nil, httpError(err)
	})
}

func (s *Server) startRecording(ctx context.Context, provider, id string, ev *audit.Event) (RecordingView, error) {
	_, sess, err := s.ownedSession(ctx, provider, id)
	if err != nil {
		return RecordingView{}, err
	}
	ev.Artifact = sess.ArtifactRef
	if sess.State != contract.StateReady {
		return RecordingView{}, fmt.Errorf("%w: the session is not ready", contract.ErrInvalid)
	}
	c, err := s.agentClient(ctx, provider, id)
	if err != nil {
		return RecordingView{}, err
	}
	who, _ := auth.FromContext(ctx)
	owner := auth.Identity{User: sess.Owner}
	if sess.Owner == "" {
		owner = who
	}
	target, m, err := s.newRecording(ctx, owner, sess, provider)
	if err != nil {
		return RecordingView{}, err
	}
	ev.Details = map[string]string{"recording": m.ID}
	ref := recordingRef{userDir(m.Owner), m.ID}
	if _, err := c.StartRecording(ctx, *target); err != nil {
		_ = s.recordings.remove(context.WithoutCancel(ctx), ref)
		return RecordingView{}, err
	}
	s.activity.Mark(sessionKey{provider, id})
	e := &recordingEntry{ref: ref, meta: m}
	return s.recordingView(ctx, e, ownBase(m.ID)), nil
}

// serveRecordingFile serves a recording's file to its owner or through a
// share link. Chunks are stored gzipped and sent as such.
func (s *Server) serveRecordingFile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	e, err := s.recordingFromRequest(r)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	name := r.PathValue("file")
	if name != "icon.png" && !contract.RecordingFile(name) {
		http.NotFound(w, r)
		return
	}
	rc, size, err := s.recordings.store.Get(ctx, s.recordings.fileKey(e.ref, name))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer rc.Close()
	h := w.Header()
	h.Set("Content-Length", strconv.FormatInt(size, 10))
	h.Set("X-Content-Type-Options", "nosniff")
	switch {
	case name == "manifest.json":
		h.Set("Content-Type", "application/json")
		h.Set("Cache-Control", "no-store")
	case name == "thumb.jpg":
		h.Set("Content-Type", "image/jpeg")
		h.Set("Cache-Control", "private, max-age=60")
	case name == "icon.png":
		h.Set("Content-Type", "image/png")
		h.Set("Cache-Control", "private, max-age=31536000, immutable")
	case strings.HasSuffix(name, ".gz"):
		h.Set("Content-Type", map[bool]string{true: "application/x-ndjson", false: "text/plain; charset=utf-8"}[strings.HasPrefix(name, "events-")])
		h.Set("Content-Encoding", "gzip")
		h.Set("Cache-Control", "private, max-age=31536000, immutable")
	default:
		h.Set("Content-Type", "video/mp4")
		h.Set("Cache-Control", "private, max-age=31536000, immutable")
	}
	_, _ = io.Copy(w, rc)
}

// serveRecordingLogcat sends every logcat chunk as one file: plain text, or
// a .log with ANSI colours by level.
func (s *Server) serveRecordingLogcat(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	e, err := s.recordingFromRequest(r)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	mf, err := readJSON[contract.RecordingManifest](ctx, s.recordings.store, s.recordings.fileKey(e.ref, "manifest.json"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	colored := strings.HasSuffix(r.URL.Path, ".log")
	ext := ".txt"
	if colored {
		ext = ".log"
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	name := cmp.Or(e.meta.Package, "recording") + "-" + e.ref.id + "-logcat" + ext
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	header := fmt.Sprintf("# %s %s, recording started %s; times are since the start\n",
		cmp.Or(e.meta.Label, e.meta.Package), e.meta.VersionName, mf.StartedAt.Format(time.RFC3339))
	if colored {
		header = sgr("90", strings.TrimSuffix(header, "\n")) + "\n" +
			sgr("90", "# levels: ") + sgr("90", "V") + " " + sgr("94", "D") + " " + sgr("32", "I") + " " + sgr("33", "W") + " " + sgr("31", "E") + " " + sgr("1;35", "F") +
			sgr("90", "; view with colours: less -R, bat, lnav or an ANSI-aware editor") + "\n"
	}
	_, _ = io.WriteString(w, header)
	for _, c := range mf.Logcat {
		if path.Base(c.File) != c.File || !contract.RecordingFile(c.File) {
			continue
		}
		rc, _, err := s.recordings.store.Get(ctx, s.recordings.fileKey(e.ref, c.File))
		if err != nil {
			continue
		}
		if zr, err := gzip.NewReader(rc); err == nil {
			if colored {
				copyColored(w, zr)
			} else {
				_, _ = io.Copy(w, zr)
			}
		}
		rc.Close()
	}
}

func (s *Server) recordingFromRequest(r *http.Request) (*recordingEntry, error) {
	if s.recordings == nil {
		return nil, errRecordingsDisabled
	}
	if token := r.PathValue("token"); token != "" {
		return s.sharedRecording(r.Context(), token)
	}
	return s.ownRecording(r.Context(), r.PathValue("id"))
}
