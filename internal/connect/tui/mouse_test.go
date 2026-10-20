package tui

import (
	"slices"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/holtdroid/holtdroid/internal/contract/control"
)

func find(t *testing.T, m Model, id string) (int, int) {
	t.Helper()
	frame := m.frame()
	for y, line := range strings.Split(stripZones(frame), "\n") {
		for x := range len([]rune(line)) {
			if zoneAt(frame, x, y) == id {
				return x, y
			}
		}
	}
	t.Fatalf("no %s on\n%s", id, m.View())
	return 0, 0
}

func clickCmd(t *testing.T, m Model, id string) (Model, tea.Cmd) {
	t.Helper()
	x, y := find(t, m, id)
	next, cmd := m.Update(tea.MouseMsg{X: x, Y: y, Action: tea.MouseActionPress, Button: tea.MouseButtonLeft})
	return next.(Model), cmd
}

func click(t *testing.T, m Model, id string) Model {
	t.Helper()
	m, cmd := clickCmd(t, m, id)
	return run(m, cmd)
}

func wheel(m Model, x int, down bool) Model {
	b := tea.MouseButtonWheelUp
	if down {
		b = tea.MouseButtonWheelDown
	}
	next, _ := m.Update(tea.MouseMsg{X: x, Y: 5, Action: tea.MouseActionPress, Button: b})
	return next.(Model)
}

func TestMouse(t *testing.T) {
	m, a := model(t)

	m = click(t, m, "sec:2")
	if m.section != ports || m.content {
		t.Fatalf("section %d content %v", m.section, m.content)
	}
	m = click(t, m, "row:1")
	if !m.content || m.cursor != 1 || !slices.Equal(a.toggled, []int{5173}) {
		t.Fatalf("cursor %d toggled %v", m.cursor, a.toggled)
	}
	m = click(t, m, "key:a")
	if !m.showAll {
		t.Fatal("a to show didn't show all ports")
	}
	m = wheel(m, 50, true)
	if m.cursor != 2 {
		t.Fatalf("wheel moved to %d", m.cursor)
	}
	m = wheel(m, 5, false)
	if m.section != devices || m.content {
		t.Fatalf("wheel over the menu: section %d content %v", m.section, m.content)
	}

	var opened []string
	m.openURL = func(u string) error { opened = append(opened, u); return nil }
	m = click(t, m, "row:0")
	if len(opened) != 0 || !m.content {
		t.Fatal("the first click on a device opened it")
	}
	m = click(t, m, "row:0")
	m = click(t, m, "key:n")
	if want := []string{"https://android.example.com/session/emulator/d0281282be", "https://android.example.com"}; !slices.Equal(opened, want) {
		t.Fatalf("opened %q, want %q", opened, want)
	}

	m = click(t, m, "sec:4")
	m = click(t, m, "row:1")
	if !m.prefs.AutoUpdate {
		t.Fatal("clicking automatic updates didn't tick it")
	}
}

func TestPublishMode(t *testing.T) {
	m, a := model(t)
	m = press(m, "3", "m")
	if m.confirm == nil || !strings.Contains(m.confirm.text, "every dev server") {
		t.Fatalf("m didn't ask: %+v", m.confirm)
	}
	m = click(t, m, "key:y")
	m.snap.Mode = control.PublishDev
	m.snap.Published = []int{3006, 5173, 8000, 8080}
	m.snap.Pinned = []int{3006, 8080}
	golden(t, "ports-auto", m.View())

	m = click(t, m, "mode:all")
	if m.confirm == nil || !strings.Contains(m.confirm.text, "system services") {
		t.Fatalf("everything didn't warn: %+v", m.confirm)
	}
	m = click(t, m, "key:n")
	m = click(t, m, "mode:manual")
	if m.confirm != nil {
		t.Fatal("manual asked")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if want := []string{"mode dev", "mode manual"}; !slices.Equal(a.did, want) {
		t.Fatalf("did %q, want %q", a.did, want)
	}
}

func TestInspect(t *testing.T) {
	m, _ := model(t)
	opened := 0
	m.inspect = func() error { opened++; return nil }
	m = press(m, "2", "w")
	m = click(t, m, "key:w")
	if opened != 2 || m.flash != "opened chrome://inspect/#devices" {
		t.Fatalf("opened %d, flash %q", opened, m.flash)
	}
}
