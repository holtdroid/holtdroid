package tui

import (
	"errors"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

// UpdateChoice is what the user picked when a newer client was found.
type UpdateChoice struct {
	Update bool
	Auto   bool
}

// ErrQuit means the user quit instead of choosing.
var ErrQuit = errors.New("quit")

type prompt struct {
	portal string
	skip   bool
	auto   bool
	done   bool
	quit   bool
}

func (p prompt) Init() tea.Cmd { return nil }

func (p prompt) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	k, ok := msg.(tea.KeyMsg)
	if !ok {
		return p, nil
	}
	switch k.String() {
	case "ctrl+c", "q", "esc":
		p.quit = true
		return p, tea.Quit
	case "up", "k", "down", "j", "tab":
		p.skip = !p.skip
	case " ", "a":
		p.auto = !p.auto
	case "u":
		p.skip, p.done = false, true
		return p, tea.Quit
	case "s":
		p.skip, p.done = true, true
		return p, tea.Quit
	case "enter":
		p.done = true
		return p, tea.Quit
	}
	return p, nil
}

func (p prompt) View() string {
	if p.done || p.quit {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n  " + brand.Render("holtdroid") + "  A newer client is available from " + title.Render(host(p.portal)) + ".\n\n")
	option := func(selected bool, text, note string) {
		if selected {
			b.WriteString("  " + pointer + chosen.Render(text))
		} else {
			b.WriteString("    " + text)
		}
		if note != "" {
			b.WriteString(muted.Render("  " + note))
		}
		b.WriteString("\n")
	}
	option(!p.skip, "Update now", "and start again")
	option(p.skip, "Skip", "keep this one; it may not work correctly with the portal")
	box := "[ ]"
	if p.auto {
		box = ok.Render("[x]")
	}
	b.WriteString("\n    " + box + " Update automatically from now on\n\n")
	b.WriteString(muted.Render("  ↑↓ choose · space toggles automatic updates · enter confirms · q quits") + "\n")
	return b.String()
}

func (p prompt) choice() UpdateChoice { return UpdateChoice{Update: !p.skip, Auto: p.auto} }

// AskUpdate asks in the terminal whether to update to the portal's client.
func AskUpdate(portal string) (UpdateChoice, error) {
	final, err := tea.NewProgram(prompt{portal: portal}).Run()
	if err != nil {
		return UpdateChoice{}, err
	}
	p := final.(prompt)
	if p.quit {
		return UpdateChoice{}, ErrQuit
	}
	return p.choice(), nil
}
