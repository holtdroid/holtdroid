package tui

import (
	"flag"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"

	"github.com/kriakiku/holtdroid/internal/connect"
	"github.com/kriakiku/holtdroid/internal/contract/control"
)

var update = flag.Bool("update", false, "rewrite golden files")

type actions struct{ toggled []int }

func (a *actions) TogglePublished(port int) error {
	a.toggled = append(a.toggled, port)
	return nil
}

var now = time.Date(2026, 10, 18, 19, 12, 0, 0, time.UTC)

func snapshot() connect.Snapshot {
	return connect.Snapshot{
		Portal: "https://android.example.com", Version: "v0.4.0", User: "otter", Computer: "4ma52uwpbqwcbtbp",
		Hostname: "otters-mac", Status: "connected", Connected: true,
		CertificateExpiresAt: now.Add(14 * time.Minute), RefreshExpiresAt: now.Add(30 * 24 * time.Hour),
		Fingerprint: "SHA256:Zru7u9KFnruNN8vZsTaJL9hayAphx7lrZ0uGzIib12k",
		Dir:         "/home/otter/.config/holtdroid/connect/android.example.com",
		Sessions:    []control.Session{{Slug: "emulator-d0281282be", Provider: "emulator", ID: "d0281282be"}},
		ADB:         []connect.ADBDevice{{Session: "emulator-d0281282be", Port: 15555, Connected: true}},
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
	t.Setenv("HOME", "/home/otter")
	a := &actions{}
	m := New(a, &Log{}, snapshot())
	m.now = func() time.Time { return now }
	m.exe = "/home/otter/.cache/holtdroid/holtdroid-6557e34d57c7f6f9"
	m.width, m.height = 96, 24
	m.plan = connect.Install{Path: "/home/otter/.local/bin/holtdroid", Target: "/home/otter/.cache/holtdroid/holtdroid", InPath: true}
	m.planErr = nil
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
	golden(t, "devices", press(m, "2").View())
	golden(t, "ports", press(m, "3", "right", "down").View())
	golden(t, "ports-all", press(m, "3", "right", "a").View())
	toggled := snapshot()
	toggled.Published, toggled.Active = []int{3006, 5173, 8080}, []int{3006, 5173, 8080}
	next, _ := press(m, "3", "right", "down").Update(snapMsg(toggled))
	golden(t, "ports-published", next.(Model).View())
	golden(t, "settings", press(m, "5", "right").View())
	golden(t, "settings-installed", press(m, "5", "right", "enter").View())

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
