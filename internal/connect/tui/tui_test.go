package tui

import (
	"context"
	"flag"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"

	"github.com/kriakiku/holtdroid/internal/connect"
	"github.com/kriakiku/holtdroid/internal/contract/control"
)

var update = flag.Bool("update", false, "rewrite golden files")

type actions struct {
	toggled []int
	mu      sync.Mutex
	logcat  []bool
	did     []string
}

func (a *actions) Artifacts(context.Context) ([]connect.Artifact, error) {
	return []connect.Artifact{
		{Source: "slack", ID: "a1", Name: "Shop", Version: "4.2.2", Package: "com.example.shop", UploadedAt: now.Add(-2 * time.Hour)},
		{Source: "slack", ID: "a2", Name: "Shop", Version: "4.2.1", Package: "com.example.shop", UploadedAt: now.Add(-26 * time.Hour)},
		{Source: "github", ID: "a3", Name: "Holtdroid WebView", Version: "1.4.0", Package: "dev.holtdroid.webview", UploadedAt: now.Add(-72 * time.Hour)},
	}, nil
}

func (a *actions) Launch(_ context.Context, art connect.Artifact) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.did = append(a.did, "launch "+art.ID)
	return "emulator-0a1b2c3d4e", nil
}

func (a *actions) Stop(_ context.Context, s control.Session) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.did = append(a.did, "stop "+s.Slug)
	return nil
}

func (a *actions) AppAction(_ context.Context, s control.Session, action string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.did = append(a.did, action+" "+s.Slug)
	return nil
}

func (a *actions) TogglePublished(port int) error {
	a.toggled = append(a.toggled, port)
	return nil
}

func (a *actions) DeviceInfo(context.Context, string) ([]connect.Field, error) {
	return []connect.Field{
		{Name: "Model", Value: "Google sdk_gphone64_arm64"},
		{Name: "Android", Value: "15 (API 35)"},
		{Name: "ABI", Value: "arm64-v8a"},
		{Name: "Screen", Value: "1080x2400 · 420 dpi"},
		{Name: "Battery", Value: "100%"},
		{Name: "Locale", Value: "en-US"},
		{Name: "Time zone", Value: "Europe/Berlin"},
	}, nil
}

func (a *actions) AppInfo(_ context.Context, s control.Session) ([]connect.Field, error) {
	return []connect.Field{
		{Name: "Name", Value: s.Label},
		{Name: "Package", Value: s.Package},
		{Name: "Version", Value: "4.2.1 (4210)"},
		{Name: "Target", Value: "API 35"},
		{Name: "Running", Value: "yes, pid 4200"},
		{Name: "UID", Value: "10187"},
	}, nil
}

func (a *actions) Logcat(ctx context.Context, _ control.Session, app bool, _ func(string)) error {
	a.mu.Lock()
	a.logcat = append(a.logcat, app)
	a.mu.Unlock()
	<-ctx.Done()
	return nil
}

func (a *actions) Shell(string) (io.ReadWriteCloser, error) { return nil, io.EOF }

func (a *actions) SessionURL(s control.Session) string {
	return "https://android.example.com/session/" + s.Provider + "/" + s.ID
}

var now = time.Date(2026, 10, 18, 19, 12, 0, 0, time.UTC)

func snapshot() connect.Snapshot {
	return connect.Snapshot{
		Portal: "https://android.example.com", Version: "v0.4.0", User: "otter", Computer: "4ma52uwpbqwcbtbp",
		Hostname: "otters-mac", Status: "connected", Connected: true,
		CertificateExpiresAt: now.Add(14 * time.Minute), RefreshExpiresAt: now.Add(30 * 24 * time.Hour),
		Fingerprint: "SHA256:Zru7u9KFnruNN8vZsTaJL9hayAphx7lrZ0uGzIib12k",
		Dir:         "/home/otter/.config/holtdroid/connect/android.example.com",
		Sessions: []control.Session{{
			Slug: "emulator-d0281282be", Provider: "emulator", ID: "d0281282be",
			Package: "com.example.shop", Label: "Shop", VersionName: "4.2.1",
		}},
		ADB: []connect.ADBDevice{{Session: "emulator-d0281282be", Port: 15555, Connected: true}},
		Listening: []control.LocalPort{
			{Port: 3006, Process: "node"},
			{Port: 5000, Process: "ControlCenter"},
			{Port: 5173, Process: "node"},
			{Port: 7000, Process: "ControlCenter"},
			{Port: 8000, Process: "python3.13"},
			{Port: 52391, Process: "rapportd"},
		},
		Published: []int{3006, 8080},
		Active:    []int{3006, 8080},
		Refused:   map[int]string{},
	}
}

func model(t *testing.T) (Model, *actions) {
	t.Helper()
	lipgloss.SetColorProfile(termenv.Ascii)
	time.Local = time.UTC
	t.Setenv("HOME", "/home/otter")
	a := &actions{}
	m := New(a, &Log{}, snapshot())
	m.now = func() time.Time { return now }
	m.exe = "/home/otter/.cache/holtdroid/holtdroid-6557e34d57c7f6f9"
	m.width, m.height = 96, 24
	m.plan = connect.Install{Path: "/home/otter/.local/bin/holtdroid", Target: "/home/otter/.cache/holtdroid/holtdroid", InPath: true}
	m.planErr = nil
	m.openURL = func(string) error { return nil }
	m.prefs = connect.Prefs{}
	m.savePrefs = func(connect.Prefs) error { return nil }
	m.install = func() (connect.Install, error) {
		p := m.plan
		p.Installed = true
		return p, nil
	}
	return m, a
}

func press(m Model, keys ...string) Model {
	for _, k := range keys {
		var msg tea.KeyMsg
		switch k {
		case "down", "up", "right", "left", "enter", "esc", "tab":
			msg = tea.KeyMsg{Type: map[string]tea.KeyType{
				"down": tea.KeyDown, "up": tea.KeyUp, "right": tea.KeyRight, "left": tea.KeyLeft,
				"enter": tea.KeyEnter, "esc": tea.KeyEsc, "tab": tea.KeyTab,
			}[k]}
		case " ":
			msg = tea.KeyMsg{Type: tea.KeySpace, Runes: []rune{' '}}
		default:
			msg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(k)}
		}
		next, _ := m.Update(msg)
		m = next.(Model)
	}
	return m
}

func golden(t *testing.T, name, got string) {
	t.Helper()
	got = strings.Join(trimRight(strings.Split(got, "\n")), "\n") + "\n"
	path := filepath.Join("testdata", name+".golden")
	if *update {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (run go test -update)", err)
	}
	if got != string(want) {
		t.Errorf("%s differs from %s:\n%s", name, path, got)
	}
}

func trimRight(lines []string) []string {
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " ")
	}
	return lines
}

// The golden files are also the frames of the animated terminal in the
// docs (docs/src/components/TerminalDemo.astro), so they show the real UI.
func TestScreens(t *testing.T) {
	m, _ := model(t)
	golden(t, "overview", m.View())
	golden(t, "devices", press(m, "2", "right").View())
	golden(t, "ports", press(m, "3", "right", "down").View())
	golden(t, "ports-all", press(m, "3", "right", "a").View())
	toggled := snapshot()
	toggled.Published, toggled.Active = []int{3006, 5173, 8080}, []int{3006, 5173, 8080}
	next, _ := press(m, "3", "right", "down").Update(snapMsg(toggled))
	golden(t, "ports-published", next.(Model).View())
	golden(t, "settings", press(m, "5", "right").View())
	golden(t, "settings-installed", press(m, "5", "right", "enter").View())

	old := m
	old.outdated = true
	old.update = func() (string, error) { return "/home/otter/.cache/holtdroid/holtdroid-new", nil }
	golden(t, "overview-outdated", old.View())
	golden(t, "settings-outdated", press(old, "5", "right", "down", "enter").View())
	golden(t, "update-prompt", prompt{portal: "https://android.example.com"}.View())

	connecting := m
	s := snapshot()
	s.Connected, s.Status, s.Sessions, s.ADB, s.Active = false, "reconnecting in 2s: connection refused", nil, nil, nil
	next, _ = connecting.Update(snapMsg(s))
	golden(t, "reconnecting", next.(Model).View())
}

func TestPorts(t *testing.T) {
	m, a := model(t)
	m = press(m, "3", "right")
	var got []int
	for _, r := range m.portRows() {
		got = append(got, r.port)
	}
	if want := []int{3006, 5173, 8000, 8080}; !slices.Equal(got, want) {
		t.Fatalf("rows %v, want %v", got, want)
	}
	if rows := press(m, "a").portRows(); len(rows) != 7 {
		t.Fatalf("all rows %d", len(rows))
	}

	m = press(m, "down", " ", "n", "4", "x", "4", "3", "enter")
	if want := []int{5173, 443}; !slices.Equal(a.toggled, want) {
		t.Fatalf("toggled %v, want %v", a.toggled, want)
	}
	m = press(m, "n", "9", "9", "9", "9", "9", "enter")
	if !strings.Contains(m.flash, "not a TCP port") || len(a.toggled) != 2 {
		t.Fatalf("flash %q, toggled %v", m.flash, a.toggled)
	}
	if !strings.Contains(press(m, "esc").help(), "1-5 sections") {
		t.Fatal("esc doesn't go back to the menu")
	}
}

func TestQuit(t *testing.T) {
	m, _ := model(t)
	if _, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("q")}); cmd == nil {
		t.Fatal("q doesn't quit")
	}
	if _, cmd := m.Update(doneMsg{}); cmd == nil {
		t.Fatal("the client stopping doesn't quit")
	}
}

func run(m Model, cmd tea.Cmd) Model {
	if cmd == nil {
		return m
	}
	next, _ := m.Update(cmd())
	return next.(Model)
}

func TestSession(t *testing.T) {
	m, a := model(t)
	m = press(m, "2", "right")
	next, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = next.(Model)
	if m.sess == nil || cmd == nil {
		t.Fatal("enter didn't open the session")
	}
	done := make(chan tea.Msg, 1)
	first := cmd
	go func() { done <- first() }()
	for _, l := range []string{
		"10-18 19:12:01.204 I/ActivityManager(  612): Start proc 4200:com.example.shop/u0a187 for activity",
		"10-18 19:12:01.871 D/OkHttp  ( 4200): --> GET https://api.example.com/catalog",
		"10-18 19:12:02.113 W/chromium( 4200): [WARNING:CONSOLE(118)] \"Deprecated API: document.domain setter\"",
		"10-18 19:12:02.540 E/Checkout( 4200): payment widget failed to load: net::ERR_NAME_NOT_RESOLVED",
		"10-18 19:12:03.002 I/chromium( 4200): [INFO:CONSOLE(42)] \"cart restored, 3 items\"",
	} {
		_, _ = m.sess.logcat.Write([]byte(l + "\n"))
	}
	golden(t, "session-logcat", m.View())

	next, cmd = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("f")})
	m = next.(Model)
	if !m.sess.appOnly || cmd == nil {
		t.Fatal("f didn't filter to the app")
	}
	filtered := cmd
	go func() { _ = filtered() }()

	m = press(m, "right")
	golden(t, "session-shell", m.View())
	next, cmd = m.Update(tea.KeyMsg{Type: tea.KeyRight})
	m = run(next.(Model), cmd)
	golden(t, "session-device", m.View())
	next, cmd = m.Update(tea.KeyMsg{Type: tea.KeyRight})
	m = run(next.(Model), cmd)
	golden(t, "session-app", m.View())

	m = press(m, "o")
	if !strings.Contains(m.flash, "/session/emulator/d0281282be") {
		t.Fatalf("flash %q", m.flash)
	}
	m = press(m, "esc")
	if m.sess != nil {
		t.Fatal("esc didn't close the session")
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("logcat kept running after the session closed")
	}
	eventually := time.Now().Add(5 * time.Second)
	for {
		a.mu.Lock()
		got := slices.Clone(a.logcat)
		a.mu.Unlock()
		if len(got) == 2 || time.Now().After(eventually) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !slices.Equal(a.logcat, []bool{false, true}) {
		t.Fatalf("logcat runs %v", a.logcat)
	}

	m = press(m, "right", "enter")
	s := snapshot()
	s.Sessions, s.ADB = nil, nil
	next, _ = m.Update(snapMsg(s))
	if m = next.(Model); m.sess != nil || !strings.Contains(m.flash, "stopped") {
		t.Fatalf("a stopped session stays open: %q", m.flash)
	}
}

func TestSettingsUpdates(t *testing.T) {
	m, _ := model(t)
	var saved []connect.Prefs
	m.savePrefs = func(p connect.Prefs) error {
		saved = append(saved, p)
		return nil
	}
	m = press(m, "5", "right", "down", "enter")
	if !m.prefs.AutoUpdate || len(saved) != 1 || !saved[0].AutoUpdate {
		t.Fatalf("auto update %v, saved %v", m.prefs.AutoUpdate, saved)
	}
	if len(m.settingsItems()) != 2 {
		t.Fatal("update now offered while up to date")
	}

	m.outdated = true
	m.update = func() (string, error) { return "/new/holtdroid", nil }
	next, cmd := press(m, "down").Update(tea.KeyMsg{Type: tea.KeyEnter})
	if next.(Model).Restart() != "/new/holtdroid" || cmd == nil {
		t.Fatalf("update now: restart %q", next.(Model).Restart())
	}
}

func TestUpdatePrompt(t *testing.T) {
	keys := func(ks ...string) (prompt, tea.Cmd) {
		p := prompt{portal: "https://android.example.com"}
		var cmd tea.Cmd
		for _, k := range ks {
			msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(k)}
			switch k {
			case "enter":
				msg = tea.KeyMsg{Type: tea.KeyEnter}
			case "down":
				msg = tea.KeyMsg{Type: tea.KeyDown}
			case " ":
				msg = tea.KeyMsg{Type: tea.KeySpace, Runes: []rune{' '}}
			}
			var next tea.Model
			next, cmd = p.Update(msg)
			p = next.(prompt)
		}
		return p, cmd
	}
	tests := []struct {
		keys []string
		want UpdateChoice
		quit bool
	}{
		{[]string{"enter"}, UpdateChoice{Update: true}, false},
		{[]string{" ", "enter"}, UpdateChoice{Update: true, Auto: true}, false},
		{[]string{"down", "enter"}, UpdateChoice{}, false},
		{[]string{"s"}, UpdateChoice{}, false},
		{[]string{"u"}, UpdateChoice{Update: true}, false},
		{[]string{"q"}, UpdateChoice{Update: true}, true},
	}
	for _, tt := range tests {
		p, cmd := keys(tt.keys...)
		if cmd == nil || p.quit != tt.quit || !tt.quit && p.choice() != tt.want {
			t.Errorf("%v: choice %+v quit %v", tt.keys, p.choice(), p.quit)
		}
	}
}

func TestLaunchAndActions(t *testing.T) {
	m, a := model(t)
	m = press(m, "2")
	next, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("N")})
	m = run(next.(Model), cmd)
	if m.picker == nil || len(m.picker.items) != 3 {
		t.Fatalf("picker %+v", m.picker)
	}
	golden(t, "launch", m.View())

	m = press(m, "w", "e", "b")
	if items := m.picker.visible(); len(items) != 1 || items[0].ID != "a3" {
		t.Fatalf("filtered %+v", items)
	}
	next, cmd = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = run(next.(Model), cmd)
	if m.picker != nil || !strings.Contains(m.flash, "launched Holtdroid WebView as emulator-0a1b2c3d4e") {
		t.Fatalf("after launch: %q", m.flash)
	}

	m = press(m, "X")
	if m.confirm == nil {
		t.Fatal("X didn't ask")
	}
	golden(t, "confirm-stop", m.View())
	m = press(m, "n")
	if m.confirm != nil || m.flash != "cancelled" {
		t.Fatalf("n didn't cancel: %q", m.flash)
	}
	next, cmd = press(m, "X").Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")})
	if m = next.(Model); m.flash != "stopping emulator-d0281282be…" {
		t.Fatalf("flash %q", m.flash)
	}
	m = run(m, cmd)
	if m.flash != "stopped emulator-d0281282be" {
		t.Fatalf("flash %q", m.flash)
	}

	next, cmd = press(m, "enter").Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("R")})
	m = run(next.(Model), cmd)
	next, cmd = press(m, "I").Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")})
	m = run(next.(Model), cmd)
	a.mu.Lock()
	defer a.mu.Unlock()
	want := []string{"launch a3", "stop emulator-d0281282be", "restart emulator-d0281282be", "reinstall emulator-d0281282be"}
	if !slices.Equal(a.did, want) {
		t.Fatalf("did %q, want %q", a.did, want)
	}
	if m.flash != "reinstalled Shop" {
		t.Fatalf("flash %q", m.flash)
	}
}

func TestPortalTurnedOff(t *testing.T) {
	m, a := model(t)
	s := snapshot()
	s.ADBOff, s.PublishOff, s.ADB, s.Active = true, true, nil, nil
	next, _ := m.Update(snapMsg(s))
	m = next.(Model)
	golden(t, "devices-adb-off", press(m, "2", "right").View())

	next, cmd := press(m, "2", "right").Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = next.(Model)
	if cmd != nil {
		t.Fatal("logcat started with ADB off")
	}
	golden(t, "session-adb-off", m.View())
	m = press(m, "right", "f")
	if m.sess.tab != logcatTab || m.sess.appOnly {
		t.Fatal("tabs work with ADB off")
	}
	next, cmd = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("R")})
	run(next.(Model), cmd)

	m = press(m, "3", "right", " ")
	if !strings.Contains(m.flash, "turned off") || len(a.toggled) != 0 {
		t.Fatalf("published with publishing off: %q %v", m.flash, a.toggled)
	}
	golden(t, "ports-off", m.View())
	a.mu.Lock()
	defer a.mu.Unlock()
	if !slices.Equal(a.did, []string{"restart emulator-d0281282be"}) {
		t.Fatalf("did %v", a.did)
	}
}
