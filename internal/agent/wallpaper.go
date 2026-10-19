package agent

import (
	"context"
	"fmt"
	"time"

	"github.com/kriakiku/holtdroid/internal/apk"
)

// Session describes the session the agent runs in; the provider sets it.
type Session struct {
	ID          string
	Owner       string
	ArtifactRef string
	Slot        string
	CreatedAt   string
}

type Wallpaper struct {
	Rows [][2]string `json:"rows"`
}

func (a *Agent) wallpaper(artifactRef, file string) Wallpaper {
	s := a.cfg.Session
	started := s.CreatedAt
	if t, err := time.Parse(time.RFC3339Nano, s.CreatedAt); err == nil {
		started = t.UTC().Format("2006-01-02 15:04:05 UTC")
	}
	app, build := a.cfg.Package, ""
	if meta, _, err := apk.Parse(file); err == nil {
		if meta.Label != "" {
			app = meta.Label + " · " + meta.Package
		}
		build = meta.VersionName
		if meta.VersionCode != 0 {
			build = fmt.Sprintf("%s (%d)", build, meta.VersionCode)
		}
	}
	var w Wallpaper
	for _, row := range [][2]string{
		{"session", s.ID},
		{"user", s.Owner},
		{"started", started},
		{"app", app},
		{"build", build},
		{"artifact", artifactRef},
		{"node", s.Slot},
		{"holtdroid", a.cfg.Version},
	} {
		if row[1] != "" {
			w.Rows = append(w.Rows, row)
		}
	}
	return w
}

// setWallpaper draws the session details on the home and lock screens in the
// background; a failure only costs the wallpaper.
func (a *Agent) setWallpaper(ctx context.Context, artifactRef, file string) {
	if a.cfg.NoWallpaper {
		return
	}
	w := a.wallpaper(artifactRef, file)
	go func() {
		if err := a.inst.SetWallpaper(ctx, w); err != nil {
			a.log.Warn("set wallpaper", "err", err)
		}
	}()
}
