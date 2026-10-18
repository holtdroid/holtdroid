package tui

import (
	"context"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/kriakiku/holtdroid/internal/connect"
	"github.com/kriakiku/holtdroid/internal/contract/control"
)

// picker chooses a build to launch a new device with.
type picker struct {
	items   []connect.Artifact
	loading bool
	err     string
	filter  string
	cursor  int
}

// confirm asks y/n before an action that loses something.
type confirm struct {
	text  string
	doing string
	run   tea.Cmd
}

type (
	artifactsMsg struct {
		items []connect.Artifact
		err   error
	}
	actionMsg struct {
		text string
		err  error
	}
)

func (m *Model) openPicker() tea.Cmd {
	m.picker = &picker{loading: true}
	act := m.act
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		items, err := act.Artifacts(ctx)
		return artifactsMsg{items, err}
	}
}

func (p *picker) visible() []connect.Artifact {
	if p.filter == "" {
		return p.items
	}
	f := strings.ToLower(p.filter)
	var out []connect.Artifact
	for _, a := range p.items {
		if strings.Contains(strings.ToLower(a.Name+" "+a.Package+" "+a.FileName+" "+a.Version), f) {
			out = append(out, a)
		}
	}
	return out
}

func (m Model) pickerKey(k tea.KeyMsg) (Model, tea.Cmd) {
	p := m.picker
	items := p.visible()
	switch k.Type {
	case tea.KeyEsc:
		m.picker = nil
	case tea.KeyUp:
		p.cursor = max(p.cursor-1, 0)
	case tea.KeyDown:
		p.cursor = min(p.cursor+1, max(len(items)-1, 0))
	case tea.KeyBackspace:
		if p.filter != "" {
			p.filter = p.filter[:len(p.filter)-1]
			p.cursor = 0
		}
	case tea.KeyRunes, tea.KeySpace:
		p.filter += string(k.Runes)
		p.cursor = 0
	case tea.KeyEnter:
		if p.cursor >= len(items) {
			return m, nil
		}
		a := items[p.cursor]
		m.picker = nil
		m.flash = "launching " + a.Name + "…"
		return m, m.do("launch "+a.Name, func(ctx context.Context) (string, error) {
			slug, err := m.act.Launch(ctx, a)
			return "launched " + a.Name + " as " + slug + "; it shows up here once it has booted", err
		})
	}
	return m, nil
}

// do runs an action in the background and reports how it went.
func (m Model) do(what string, run func(ctx context.Context) (string, error)) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		text, err := run(ctx)
		if err != nil {
			return actionMsg{text: what, err: err}
		}
		return actionMsg{text: text}
	}
}

// deviceAction handles the keys that act on a device: R restarts the app,
// I reinstalls it and X stops the device, the last two after a y.
func (m Model) deviceAction(key string, s control.Session) (Model, tea.Cmd, bool) {
	name := firstNonEmpty(s.Label, s.Package, s.Slug)
	switch key {
	case "R":
		m.flash = "restarting " + name + "…"
		return m, m.do("restart "+name, func(ctx context.Context) (string, error) {
			return "restarted " + name, m.act.AppAction(ctx, s, "restart")
		}), true
	case "I":
		m.confirm = &confirm{
			text:  "Reinstall " + name + "? Its data is lost.",
			doing: "reinstalling " + name + "…",
			run: m.do("reinstall "+name, func(ctx context.Context) (string, error) {
				return "reinstalled " + name, m.act.AppAction(ctx, s, "reinstall")
			}),
		}
		return m, nil, true
	case "X":
		m.confirm = &confirm{
			text:  "Stop " + name + " on " + s.Slug + "?",
			doing: "stopping " + s.Slug + "…",
			run: m.do("stop "+name, func(ctx context.Context) (string, error) {
				return "stopped " + s.Slug, m.act.Stop(ctx, s)
			}),
		}
		return m, nil, true
	}
	return m, nil, false
}

func (m Model) pickerView(rows int) string {
	p := m.picker
	var b strings.Builder
	b.WriteString(title.Render("Launch a device") + muted.Render("  type to filter · enter launches · esc cancels") + "\n\n")
	b.WriteString(muted.Render("Filter ") + p.filter + "█\n\n")
	switch {
	case p.loading:
		b.WriteString(muted.Render("Loading builds…"))
		return b.String()
	case p.err != "":
		b.WriteString(bad.Render(p.err))
		return b.String()
	}
	items := p.visible()
	if len(items) == 0 {
		b.WriteString(muted.Render("No build matches."))
		return b.String()
	}
	visible := max(rows-5, 3)
	start := 0
	if p.cursor >= visible {
		start = p.cursor - visible + 1
	}
	for i, a := range items {
		if i < start || i >= start+visible {
			continue
		}
		name := a.Name
		if a.Version != "" {
			name += " " + a.Version
		}
		line := title.Render(name) + "  " + muted.Render(firstNonEmpty(a.Package, a.FileName)+" · "+ago(a.UploadedAt, m.now()))
		if i == p.cursor {
			b.WriteString(pointer + line + "\n")
		} else {
			b.WriteString("  " + line + "\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

func ago(t, now time.Time) string {
	d := now.Sub(t)
	switch {
	case t.IsZero():
		return ""
	case d < time.Hour:
		return "just now"
	case d < 48*time.Hour:
		return strings.TrimSuffix(d.Round(time.Hour).String(), "0m0s") + " ago"
	default:
		return t.Local().Format("2 Jan")
	}
}
