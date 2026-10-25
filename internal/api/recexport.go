package api

import (
	"archive/zip"
	"cmp"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"slices"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/storage"
)

const (
	bundleFormat   = "holtdroid-recording"
	bundleVersion  = 1
	bundleMetaFile = "holtdroid.json"
)

// bundleMeta is the first file of a .holtdroid archive: what the recording
// is, with nothing that points back at the server it came from.
type bundleMeta struct {
	Format     string            `json:"format"`
	Version    int               `json:"version"`
	ExportedAt time.Time         `json:"exportedAt"`
	Recording  RecordingView     `json:"recording"`
	Markers    []RecordingMarker `json:"markers"`
}

// serveRecordingExport streams every file of a recording as one ZIP, the
// video and logs stored as they are (they are compressed already), so the
// archive opens in any tool and a browser can play it from disk.
func (s *Server) serveRecordingExport(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	e, err := s.recordingFromRequest(r)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	view := s.recordingView(ctx, e, "")
	view.Owner, view.Provider, view.Session = "", "", ""
	view.FilesURL, view.IconURL, view.ThumbnailURL, view.LogcatURL, view.LogcatLogURL, view.ExportURL = "", "", "", "", "", ""
	view.Keep, view.ExpiresAt, view.Share = false, nil, nil
	meta, err := json.Marshal(bundleMeta{
		Format: bundleFormat, Version: bundleVersion, ExportedAt: s.now().UTC(), Recording: view, Markers: s.recordings.markers(ctx, e.ref),
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	prefix := s.recordings.fileKey(e.ref, "")
	objs, err := s.recordings.store.List(ctx, prefix)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	slices.SortFunc(objs, func(a, b storage.Object) int { return cmp.Compare(a.Key, b.Key) })

	w.Header().Set("Content-Type", "application/zip")
	name := cmp.Or(e.meta.Package, "recording") + "-" + e.ref.id + ".holtdroid"
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	zw := zip.NewWriter(w)
	defer zw.Close()

	add := func(name string, modified time.Time) (io.Writer, error) {
		return zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store, Modified: modified})
	}
	if fw, err := add(bundleMetaFile, s.now()); err == nil {
		_, _ = fw.Write(meta)
	}
	for _, o := range objs {
		name := path.Base(o.Key)
		if name != "icon.png" && !contract.RecordingFile(name) {
			continue
		}
		rc, _, err := s.recordings.store.Get(ctx, o.Key)
		if err != nil {
			s.log.Warn("recording export: a file is missing", "recording", e.ref.id, "file", name, "err", err)
			continue
		}
		fw, err := add(name, o.Modified)
		if err == nil {
			_, err = io.Copy(fw, rc)
		}
		rc.Close()
		if err != nil {
			return
		}
	}
}
