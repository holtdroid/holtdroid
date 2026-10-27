package api

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/storage"
)

const (
	mediaPrefix = "media/"
	mediaPath   = "/api/v1/media"
)

var (
	errMediaDisabled = errors.New("the media library is turned off on this server")
	errMediaQuota    = errors.New("the media library is full; delete some files first")
)

// mediaMeta is written only by the api, on upload.
type mediaMeta struct {
	ID          string    `json:"id"`
	Owner       string    `json:"owner"`
	Name        string    `json:"name"`
	ContentType string    `json:"contentType"`
	CreatedAt   time.Time `json:"createdAt"`
}

// mediaStore lays a user's files out as <user>/<id>.json (mediaMeta) and
// <user>/<id>.bin, so one listing gives the sizes.
type mediaStore struct {
	store  storage.Store
	prefix string
}

type mediaEntry struct {
	id   string
	size int64
	meta bool
}

func (m *mediaStore) key(user, id, ext string) string { return m.prefix + user + "/" + id + ext }

func (m *mediaStore) list(ctx context.Context, user string) ([]*mediaEntry, error) {
	objs, err := m.store.List(ctx, m.prefix+user+"/")
	if err != nil {
		return nil, err
	}
	byID := map[string]*mediaEntry{}
	var order []*mediaEntry
	for _, o := range objs {
		id, ext, _ := strings.Cut(strings.TrimPrefix(o.Key, m.prefix+user+"/"), ".")
		if !recordingID.MatchString(id) {
			continue
		}
		e := byID[id]
		if e == nil {
			e = &mediaEntry{id: id}
			byID[id] = e
			order = append(order, e)
		}
		switch ext {
		case "bin":
			e.size = o.Size
		case "json":
			e.meta = true
		}
	}
	return order, nil
}

func (m *mediaStore) remove(ctx context.Context, user, id string) error {
	for _, ext := range []string{".json", ".bin"} {
		if err := m.store.Delete(ctx, m.key(user, id, ext)); err != nil && !errors.Is(err, storage.ErrNotExist) {
			return err
		}
	}
	return nil
}

type MediaView struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	ContentType string    `json:"contentType"`
	Kind        string    `json:"kind" enum:"audio,video"`
	Size        int64     `json:"size" doc:"bytes"`
	CreatedAt   time.Time `json:"createdAt"`
}

type MediaList struct {
	Enabled     bool        `json:"enabled"`
	Quota       int64       `json:"quota" doc:"bytes a user's files may take, 0 for no limit"`
	Used        int64       `json:"used" doc:"bytes the caller's files take"`
	MaxFileSize int64       `json:"maxFileSize" doc:"bytes"`
	Items       []MediaView `json:"items"`
}

func mediaView(m mediaMeta, size int64) MediaView {
	kind := "audio"
	if strings.HasPrefix(m.ContentType, "video/") {
		kind = "video"
	}
	return MediaView{ID: m.ID, Name: m.Name, ContentType: m.ContentType, Kind: kind, Size: size, CreatedAt: m.CreatedAt}
}

// mediaType is the file's audio or video type, from the browser or else its
// extension; anything else is not a media file.
func mediaType(header, filename string) string {
	for _, t := range []string{header, mime.TypeByExtension(strings.ToLower(filepath.Ext(filename)))} {
		t, _, _ = mime.ParseMediaType(t)
		if strings.HasPrefix(t, "audio/") || strings.HasPrefix(t, "video/") {
			return t
		}
	}
	return ""
}

func (s *Server) ownMedia(ctx context.Context, id string) (mediaMeta, string, error) {
	if s.media == nil {
		return mediaMeta{}, "", errMediaDisabled
	}
	if !recordingID.MatchString(id) {
		return mediaMeta{}, "", fmt.Errorf("%w: media file %s", contract.ErrNotFound, id)
	}
	who, _ := auth.FromContext(ctx)
	user := userDir(who.User)
	m, err := readJSON[mediaMeta](ctx, s.media.store, s.media.key(user, id, ".json"))
	if err == nil && m.Owner != who.User {
		err = fmt.Errorf("%w: media file %s", contract.ErrNotFound, id)
	}
	return m, user, err
}

type mediaUploadInput struct {
	RawBody huma.MultipartFormFiles[struct {
		File huma.FormFile `form:"file" contentType:"audio/*,video/*,application/octet-stream" required:"true"`
		Name string        `form:"name" maxLength:"120" required:"false"`
	}]
}

type mediaPathInput struct {
	ID string `path:"id"`
}

func (s *Server) uploadMedia(ctx context.Context, in *mediaUploadInput) (MediaView, error) {
	if s.media == nil {
		return MediaView{}, errMediaDisabled
	}
	form := in.RawBody.Data()
	defer form.File.Close()
	if max := int64(s.cfg.Media.MaxFileSize); form.File.Size > max {
		return MediaView{}, fmt.Errorf("%w: the file is larger than %d bytes", contract.ErrTooLarge, max)
	}
	contentType := mediaType(form.File.ContentType, form.File.Filename)
	if contentType == "" {
		return MediaView{}, fmt.Errorf("%w: not an audio or video file", contract.ErrInvalid)
	}
	who, _ := auth.FromContext(ctx)
	user := userDir(who.User)
	if quota := s.limits(ctx, who.User).MediaQuota; quota > 0 {
		entries, err := s.media.list(ctx, user)
		if err != nil {
			return MediaView{}, err
		}
		var used int64
		for _, e := range entries {
			used += e.size
		}
		if used+form.File.Size > quota {
			return MediaView{}, errMediaQuota
		}
	}
	now := s.now().UTC()
	name := cleanReferenceName(form.Name)
	if name == "" {
		name = cleanReferenceName(strings.TrimSuffix(form.File.Filename, filepath.Ext(form.File.Filename)))
	}
	m := mediaMeta{ID: newAppDataID(now), Owner: who.User, Name: cmp.Or(name, "Media"), ContentType: contentType, CreatedAt: now}
	if err := s.media.store.Put(ctx, s.media.key(user, m.ID, ".bin"), form.File, form.File.Size); err != nil {
		return MediaView{}, err
	}
	if err := writeJSON(ctx, s.media.store, s.media.key(user, m.ID, ".json"), m); err != nil {
		_ = s.media.remove(ctx, user, m.ID)
		return MediaView{}, err
	}
	return mediaView(m, form.File.Size), nil
}

func (s *Server) listMedia(ctx context.Context) (MediaList, error) {
	l := MediaList{Items: []MediaView{}}
	if s.media == nil {
		return l, nil
	}
	who, _ := auth.FromContext(ctx)
	l.Enabled, l.Quota, l.MaxFileSize = true, s.limits(ctx, who.User).MediaQuota, int64(s.cfg.Media.MaxFileSize)
	user := userDir(who.User)
	entries, err := s.media.list(ctx, user)
	if err != nil {
		return MediaList{}, err
	}
	for _, e := range entries {
		l.Used += e.size
		if !e.meta {
			continue
		}
		m, err := readJSON[mediaMeta](ctx, s.media.store, s.media.key(user, e.id, ".json"))
		if err != nil || m.Owner != who.User {
			continue
		}
		l.Items = append(l.Items, mediaView(m, e.size))
	}
	slices.SortFunc(l.Items, func(a, b MediaView) int { return b.CreatedAt.Compare(a.CreatedAt) })
	return l, nil
}

type SetSessionMicrophone struct {
	Source  contract.MicrophoneSource `json:"source" enum:"off,tone,beeps,noise,file" doc:"the browser's microphone takes over through the session's /microphone/browser WebSocket instead"`
	MediaID string                    `json:"mediaId,omitempty" doc:"a file of the caller's media library, for the file source"`
}

type sessionMicrophoneInput struct {
	Provider string `path:"provider"`
	ID       string `path:"id"`
	Body     SetSessionMicrophone
}

func (s *Server) setSessionMicrophone(ctx context.Context, in *sessionMicrophoneInput) (contract.Microphone, error) {
	_, sess, err := s.ownedSession(ctx, in.Provider, in.ID)
	if err != nil {
		return contract.Microphone{}, err
	}
	req := contract.SetMicrophone{Source: in.Body.Source}
	if in.Body.Source == contract.MicFile {
		m, user, err := s.ownMedia(ctx, in.Body.MediaID)
		if err != nil {
			return contract.Microphone{}, err
		}
		req.MediaID, req.File = m.ID, m.Name
		req.FileURL = strings.TrimRight(s.cfg.InternalURL, "/") + "/internal/media/" + user + "/" + m.ID
	}
	c, err := s.agentClient(ctx, in.Provider, sess.ID)
	if err != nil {
		return contract.Microphone{}, err
	}
	s.activity.Mark(sessionKey{in.Provider, sess.ID})
	return c.SetMicrophone(ctx, req)
}

func (s *Server) registerMedia(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "listMedia", Method: http.MethodGet, Path: mediaPath, Tags: tags,
		Description: "The caller's audio and video files for the device's microphone, newest first, with their quota.",
	}, func(ctx context.Context, _ *struct{}) (*out[MediaList], error) {
		l, err := s.listMedia(ctx)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[MediaList]{l}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "uploadMedia", Method: http.MethodPost, Path: mediaPath, Tags: tags,
		DefaultStatus: http.StatusCreated, MaxBodyBytes: int64(s.cfg.Media.MaxFileSize) + 1<<20, BodyReadTimeout: -1,
		Description: "Adds an audio or video file, at most media.maxFileSize. Fails with 507 when it would go over the caller's quota.",
	}, func(ctx context.Context, in *mediaUploadInput) (*out[MediaView], error) {
		v, err := s.uploadMedia(ctx, in)
		s.emitResult(ctx, audit.Event{Action: audit.MediaUpload, Details: map[string]string{"media": v.ID, "name": v.Name}}, err)
		if errors.Is(err, errMediaQuota) {
			return nil, huma.NewError(http.StatusInsufficientStorage, err.Error())
		}
		if err != nil {
			return nil, httpError(err)
		}
		return &out[MediaView]{v}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "deleteMedia", Method: http.MethodDelete, Path: mediaPath + "/{id}", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *mediaPathInput) (*struct{}, error) {
		m, user, err := s.ownMedia(ctx, in.ID)
		if err == nil {
			err = s.media.remove(ctx, user, m.ID)
		}
		s.emitResult(ctx, audit.Event{Action: audit.MediaDelete, Details: map[string]string{"media": in.ID, "name": m.Name}}, err)
		return nil, httpError(err)
	})

	huma.Register(api, huma.Operation{
		OperationID: "setSessionMicrophone", Method: http.MethodPut, Path: "/api/v1/sessions/{provider}/{id}/microphone", Tags: tags,
		Description: "Replaces what the session's microphone hears: a test signal, a file of the caller's media library, or nothing.",
	}, func(ctx context.Context, in *sessionMicrophoneInput) (*out[contract.Microphone], error) {
		m, err := s.setSessionMicrophone(ctx, in)
		details := map[string]string{"source": string(in.Body.Source)}
		if in.Body.MediaID != "" {
			details["media"] = in.Body.MediaID
		}
		s.emitResult(ctx, audit.Event{Action: audit.SessionMicrophone, Provider: in.Provider, Session: in.ID, Details: details}, err)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[contract.Microphone]{m}, nil
	})
}

// serveInternalMedia hands an agent the file a session's microphone plays.
func (s *Server) serveInternalMedia(w http.ResponseWriter, r *http.Request) {
	user, id := r.PathValue("user"), r.PathValue("id")
	if s.media == nil || !userHash.MatchString(user) || !recordingID.MatchString(id) {
		http.NotFound(w, r)
		return
	}
	rc, size, err := s.media.store.Get(r.Context(), s.media.key(user, id, ".bin"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	_, _ = io.Copy(w, rc)
}
