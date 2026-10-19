package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kriakiku/holtdroid/internal/agent/phone"
)

type shellDevice interface {
	Shell(ctx context.Context, cmd string) (string, error)
}

// Launcher starts apps through the launcher intent, without instrumentation:
// WebView debugging is then up to the app, which debuggable builds turn on.
// On a phone whose Holtdroid Tunnel is the device owner the app starts in
// its soft kiosk instead.
type Launcher struct {
	dev      shellDevice
	interval time.Duration
	timeout  time.Duration

	once     sync.Once
	mu       sync.Mutex
	apps     map[int]*launchedApp
	spawning bool
	launched func(App)
}

func NewLauncher(dev shellDevice) *Launcher {
	return &Launcher{dev: dev, interval: time.Second, timeout: 15 * time.Second, apps: map[int]*launchedApp{}}
}

type launchedApp struct {
	dev  shellDevice
	pkg  string
	pid  int
	done chan struct{}
}

func (a *launchedApp) Done() <-chan struct{} { return a.done }

func (a *launchedApp) Kill(ctx context.Context) error {
	_, err := a.dev.Shell(ctx, "am force-stop "+a.pkg)
	return err
}

func (l *Launcher) Spawn(ctx context.Context, pkg string) (App, error) {
	if !packageName.MatchString(pkg) {
		return nil, fmt.Errorf("bad package name %q", pkg)
	}
	l.watch(ctx, pkg)
	l.mu.Lock()
	l.spawning = true
	l.mu.Unlock()
	defer func() {
		l.mu.Lock()
		l.spawning = false
		l.mu.Unlock()
	}()

	if phone.Owner(ctx, l.dev) {
		if err := phone.StartSession(ctx, l.dev, pkg); err != nil {
			return nil, err
		}
	} else {
		out, err := l.dev.Shell(ctx, "monkey -p "+pkg+" -c android.intent.category.LAUNCHER 1")
		if err != nil {
			return nil, err
		}
		if strings.Contains(out, "No activities found") || strings.Contains(out, "monkey aborted") {
			return nil, fmt.Errorf("%s has no launcher activity", pkg)
		}
	}
	ctx, cancel := context.WithTimeout(ctx, l.timeout)
	defer cancel()
	for {
		pids, _ := l.pids(ctx, pkg)
		l.mu.Lock()
		for _, pid := range pids {
			if _, ok := l.apps[pid]; !ok {
				app := l.add(pkg, pid)
				l.mu.Unlock()
				return app, nil
			}
		}
		l.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("%s did not start: %w", pkg, ctx.Err())
		case <-time.After(l.interval / 4):
		}
	}
}

func (l *Launcher) Watch(ctx context.Context, pkg string, launched func(App)) error {
	l.mu.Lock()
	l.launched = launched
	l.mu.Unlock()
	l.watch(ctx, pkg)
	return nil
}

// SetWallpaper has Holtdroid Tunnel draw the wallpaper.
func (l *Launcher) SetWallpaper(ctx context.Context, w Wallpaper) error {
	raw, err := json.Marshal(w)
	if err != nil {
		return err
	}
	return phone.SetWallpaper(ctx, l.dev, raw)
}

func (l *Launcher) add(pkg string, pid int) *launchedApp {
	app := &launchedApp{dev: l.dev, pkg: pkg, pid: pid, done: make(chan struct{})}
	l.apps[pid] = app
	return app
}

func (l *Launcher) watch(ctx context.Context, pkg string) {
	l.once.Do(func() { go l.poll(ctx, pkg) })
}

// poll ends apps whose process is gone and hands processes the device
// started by itself to launched.
func (l *Launcher) poll(ctx context.Context, pkg string) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(l.interval):
		}
		pids, err := l.pids(ctx, pkg)
		if err != nil {
			continue
		}
		var started []App
		l.mu.Lock()
		for pid, app := range l.apps {
			if !slices.Contains(pids, pid) {
				close(app.done)
				delete(l.apps, pid)
			}
		}
		if !l.spawning && l.launched != nil {
			for _, pid := range pids {
				if _, ok := l.apps[pid]; !ok {
					started = append(started, l.add(pkg, pid))
				}
			}
		}
		launched := l.launched
		l.mu.Unlock()
		for _, app := range started {
			launched(app)
		}
	}
}

func (l *Launcher) pids(ctx context.Context, pkg string) ([]int, error) {
	out, err := l.dev.Shell(ctx, "pidof "+pkg+" || true")
	if err != nil {
		return nil, err
	}
	var pids []int
	for f := range strings.FieldsSeq(out) {
		if pid, err := strconv.Atoi(f); err == nil {
			pids = append(pids, pid)
		}
	}
	return pids, nil
}
