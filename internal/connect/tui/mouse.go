package tui

import (
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/holtdroid/holtdroid/internal/contract/control"
)

func row(i int) string { return "row:" + strconv.Itoa(i) }

func keyMsg(k string) tea.KeyMsg {
	switch k {
	case "enter":
		return tea.KeyMsg{Type: tea.KeyEnter}
	case "esc":
		return tea.KeyMsg{Type: tea.KeyEsc}
	case "up":
		return tea.KeyMsg{Type: tea.KeyUp}
	case "down":
		return tea.KeyMsg{Type: tea.KeyDown}
	case "left":
		return tea.KeyMsg{Type: tea.KeyLeft}
	case "right":
		return tea.KeyMsg{Type: tea.KeyRight}
	case " ":
		return tea.KeyMsg{Type: tea.KeySpace, Runes: []rune{' '}}
	}
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(k)}
}

// mouse turns clicks on marked parts of the screen into what their keys
// do, and the wheel into ↑↓ for the list under it.
func (m Model) mouse(msg tea.MouseMsg) (tea.Model, tea.Cmd) {
	if msg.Action != tea.MouseActionPress {
		return m, nil
	}
	switch msg.Button {
	case tea.MouseButtonWheelUp, tea.MouseButtonWheelDown:
		return m.wheel(msg)
	case tea.MouseButtonLeft:
	default:
		return m, nil
	}
	id := zoneAt(m.frame(), msg.X, msg.Y)
	if m.confirm != nil {
		if id == "key:y" {
			return m.key(keyMsg("y"))
		}
		return m.key(keyMsg("n"))
	}
	kind, arg, _ := strings.Cut(id, ":")
	n, _ := strconv.Atoi(arg)
	switch kind {
	case "key":
		return m.key(keyMsg(arg))
	case "sec":
		m.adding, m.input, m.flash = false, "", ""
		m.section, m.content, m.cursor = section(n), false, 0
	case "row":
		return m.clickRow(n)
	case "mode":
		return m.askMode(control.PublishMode(arg))
	}
	return m, nil
}

// clickRow picks a row; a second click on a device opens it, while ports
// and settings act on the first click.
func (m Model) clickRow(n int) (tea.Model, tea.Cmd) {
	again := m.content && m.cursor == n
	m.content, m.cursor = true, n
	if m.section == devices && !again {
		return m, nil
	}
	return m.key(keyMsg("enter"))
}

func (m Model) wheel(msg tea.MouseMsg) (tea.Model, tea.Cmd) {
	k := "down"
	if msg.Button == tea.MouseButtonWheelUp {
		k = "up"
	}
	switch {
	case m.confirm != nil || m.adding:
		return m, nil
	case msg.X < sidebarWidth:
		m.content = false
	case m.focusable():
		m.content = true
	default:
		return m, nil
	}
	return m.key(keyMsg(k))
}
