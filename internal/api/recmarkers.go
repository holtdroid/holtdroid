package api

import (
	"cmp"
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
)

const maxMarkers = 200

// RecordingMarker is a pin on a recording's timeline: something worth
// coming back to, set while recording or later.
type RecordingMarker struct {
	ID    string `json:"id" doc:"empty on a new marker"`
	T     int64  `json:"t" minimum:"0" maximum:"86400000" doc:"milliseconds since the recording started"`
	Label string `json:"label,omitempty" maxLength:"120"`
	Icon  string `json:"icon" enum:"pin,bug,flag,star,alert,check"`
}

type RecordingMarkers struct {
	Items []RecordingMarker `json:"items" maxItems:"200"`
}

// RecordingMarkersInput is what a client sends: new markers have no id yet
// and the icon may be left out.
type RecordingMarkersInput struct {
	Items []struct {
		ID    string `json:"id,omitempty"`
		T     int64  `json:"t" minimum:"0" maximum:"86400000"`
		Label string `json:"label,omitempty" maxLength:"120"`
		Icon  string `json:"icon,omitempty" enum:"pin,bug,flag,star,alert,check"`
	} `json:"items" maxItems:"200"`
}

func (r *recordingStore) markers(ctx context.Context, ref recordingRef) []RecordingMarker {
	m, err := readJSON[RecordingMarkers](ctx, r.store, r.metaKey(ref, ".markers.json"))
	if err != nil || m.Items == nil {
		return []RecordingMarker{}
	}
	return m.Items
}

func (r *recordingStore) writeMarkers(ctx context.Context, ref recordingRef, items []RecordingMarker) error {
	slices.SortStableFunc(items, func(a, b RecordingMarker) int { return cmp.Compare(a.T, b.T) })
	return writeJSON(ctx, r.store, r.metaKey(ref, ".markers.json"), RecordingMarkers{Items: items})
}

var markerIcons = []string{"pin", "bug", "flag", "star", "alert", "check"}

// clean fills what a marker left out and rejects what can't be right.
func cleanMarkers(in []RecordingMarker) ([]RecordingMarker, error) {
	if len(in) > maxMarkers {
		return nil, fmt.Errorf("%w: at most %d markers", contract.ErrInvalid, maxMarkers)
	}
	seen := map[string]bool{}
	out := make([]RecordingMarker, 0, len(in))
	for _, m := range in {
		if m.ID == "" || seen[m.ID] {
			m.ID = randomHex(4)
		}
		seen[m.ID] = true
		m.Label = strings.TrimSpace(m.Label)
		if m.Icon == "" {
			m.Icon = "pin"
		}
		if !slices.Contains(markerIcons, m.Icon) {
			return nil, fmt.Errorf("%w: unknown marker icon %q", contract.ErrInvalid, m.Icon)
		}
		if m.T < 0 || len([]rune(m.Label)) > 120 {
			return nil, fmt.Errorf("%w: marker out of range", contract.ErrInvalid)
		}
		out = append(out, m)
	}
	return out, nil
}

type markersInput struct {
	ID   string `path:"id"`
	Body RecordingMarkersInput
}

type sessionMarkerInput struct {
	Provider string `path:"provider"`
	ID       string `path:"id"`
	Body     struct {
		Label string `json:"label,omitempty" maxLength:"120"`
		Icon  string `json:"icon,omitempty" enum:"pin,bug,flag,star,alert,check"`
	}
}

type SessionMarker struct {
	Recording string          `json:"recording"`
	Marker    RecordingMarker `json:"marker"`
}

func (s *Server) registerMarkers(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "setRecordingMarkers", Method: http.MethodPut, Path: "/api/v1/recordings/{id}/markers", Tags: tags,
		Description: "Replaces the recording's markers: pins on its timeline. Markers without an id get one.",
	}, func(ctx context.Context, in *markersInput) (*out[RecordingMarkers], error) {
		e, err := s.ownRecording(ctx, in.ID)
		if err != nil {
			return nil, httpError(err)
		}
		raw := make([]RecordingMarker, len(in.Body.Items))
		for i, m := range in.Body.Items {
			raw[i] = RecordingMarker{ID: m.ID, T: m.T, Label: m.Label, Icon: m.Icon}
		}
		items, err := cleanMarkers(raw)
		if err == nil {
			err = s.recordings.writeMarkers(ctx, e.ref, items)
		}
		if err != nil {
			return nil, httpError(err)
		}
		return &out[RecordingMarkers]{RecordingMarkers{Items: items}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "addSessionMarker", Method: http.MethodPost, Path: "/api/v1/sessions/{provider}/{id}/recording/markers", Tags: tags,
		Description: "Puts a marker on the session's recording at this moment, by the agent's own clock.",
	}, func(ctx context.Context, in *sessionMarkerInput) (*out[SessionMarker], error) {
		ev := audit.Event{Action: audit.RecordingMarker, Provider: in.Provider, Session: in.ID}
		v, err := s.addSessionMarker(ctx, in, &ev)
		s.emitResult(ctx, ev, err)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[SessionMarker]{v}, nil
	})
}

func (s *Server) addSessionMarker(ctx context.Context, in *sessionMarkerInput, ev *audit.Event) (SessionMarker, error) {
	if s.recordings == nil {
		return SessionMarker{}, errRecordingsDisabled
	}
	_, sess, err := s.ownedSession(ctx, in.Provider, in.ID)
	if err != nil {
		return SessionMarker{}, err
	}
	ev.Artifact = sess.ArtifactRef
	c, err := s.agentClient(ctx, in.Provider, in.ID)
	if err != nil {
		return SessionMarker{}, err
	}
	st, err := c.Recording(ctx)
	if err != nil {
		return SessionMarker{}, err
	}
	if !st.Active || st.ID == "" {
		return SessionMarker{}, fmt.Errorf("%w: nothing is being recorded", contract.ErrInvalid)
	}
	ref := recordingRef{userDir(sess.Owner), st.ID}
	meta, err := s.recordings.meta(ctx, ref, s.now())
	if err != nil {
		return SessionMarker{}, err
	}
	if meta.Session != sess.ID {
		return SessionMarker{}, fmt.Errorf("%w: recording %s", contract.ErrNotFound, st.ID)
	}
	ev.Details = map[string]string{"recording": st.ID}
	added := RecordingMarker{ID: randomHex(4), T: st.Duration, Label: in.Body.Label, Icon: in.Body.Icon}
	items, err := cleanMarkers(append(s.recordings.markers(ctx, ref), added))
	if err != nil {
		return SessionMarker{}, err
	}
	if err := s.recordings.writeMarkers(ctx, ref, items); err != nil {
		return SessionMarker{}, err
	}
	s.activity.Mark(sessionKey{in.Provider, in.ID})
	who, _ := auth.FromContext(ctx)
	s.log.Debug("marker added", "recording", st.ID, "by", who.User, "t", time.Duration(st.Duration)*time.Millisecond)
	return SessionMarker{Recording: st.ID, Marker: items[slices.IndexFunc(items, func(m RecordingMarker) bool { return m.ID == added.ID })]}, nil
}
