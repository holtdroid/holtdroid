package tui

import (
	"slices"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
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

	m = click(t, m, "row:0")
	if m.sess != nil || !m.content {
		t.Fatal("the first click on a device opened it")
	}
	if m, _ = clickCmd(t, m, "row:0"); m.sess == nil {
		t.Fatal("the second click didn't open the device")
	}
	m = click(t, m, "tab:2")
	if m.sess.tab != deviceTab || len(m.sess.device) == 0 {
		t.Fatalf("tab %d device %v", m.sess.tab, m.sess.device)
	}

	m = click(t, m, "key:X")
	if m.confirm == nil {
		t.Fatal("X stop didn't ask")
	}
	m = click(t, m, "key:n")
	if m.confirm != nil || m.flash != "cancelled" {
		t.Fatalf("no didn't cancel: %q", m.flash)
	}
	m = click(t, click(t, m, "key:X"), "key:y")
	if m.flash != "stopped emulator-d0281282be" {
		t.Fatalf("flash %q", m.flash)
	}

	m = click(t, m, "key:esc")
	if m.sess != nil {
		t.Fatal("esc back didn't close the device")
	}
	m = click(t, m, "key:N")
	if m.picker == nil || len(m.picker.items) != 3 {
		t.Fatalf("picker %+v", m.picker)
	}
	m = click(t, click(t, m, "row:2"), "row:2")
	if m.picker != nil || !slices.Contains(a.did, "launch a3") {
		t.Fatalf("did %v", a.did)
	}

	m = click(t, m, "sec:4")
	m = click(t, m, "row:1")
	if !m.prefs.AutoUpdate {
		t.Fatal("clicking automatic updates didn't tick it")
	}
}
