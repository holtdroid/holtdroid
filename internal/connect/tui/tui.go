// Package tui is the holtdroid client's terminal UI: sections on the left,
// the chosen one on the right.
package tui

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/kriakiku/holtdroid/internal/connect"
)

type section int

const (
	overview section = iota
	devices
	ports
	logs
	settings
)

var sections = []string{"Overview", "Devices", "Ports", "Log", "Settings"}

// Actions are what the UI can ask the client to do.
type Actions interface {
	TogglePublished(port int) error
}

type Model struct {
	snap    connect.Snapshot
	act     Actions
	log     *Log
	now     func() time.Time
	install func() (connect.Install, error)
	exe     string

	section section
	content bool
	cursor  int
	showAll bool
	adding  bool
	input   string
	flash   string
	plan    connect.Install
	planErr error
	width   int
	height  int
	err     error
}

func New(act Actions, log *Log, snap connect.Snapshot) Model {
	plan, err := connect.InstallPlan()
	exe, _ := os.Executable()
	return Model{
		exe:  exe,
		snap: snap, act: act, log: log, now: time.Now, install: connect.InstallCommand,
		plan: plan, planErr: err, width: 100, height: 30,
	}
}

type (
	snapMsg connect.Snapshot
	logMsg  struct{}
	tickMsg struct{}
	doneMsg struct{ err error }
)

func tick() tea.Cmd {
	return tea.Tick(time.Second, func(time.Time) tea.Msg { return tickMsg{} })
}

func (m Model) Init() tea.Cmd { return tick() }

// Err is why the client stopped, if it stopped by itself.
func (m Model) Err() error { return m.err }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
	case snapMsg:
		m.snap = connect.Snapshot(msg)
		m.cursor = min(m.cursor, max(len(m.portRows())-1, 0))
	case logMsg:
	case tickMsg:
		return m, tick()
	case doneMsg:
		m.err = msg.err
		return m, tea.Quit
	case tea.KeyMsg:
		return m.key(msg)
	}
	return m, nil
}

func (m Model) key(k tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.adding {
		switch k.Type {
		case tea.KeyEsc:
			m.adding, m.input = false, ""
		case tea.KeyEnter:
			m.adding = false
			if p, err := strconv.Atoi(m.input); err == nil && p >= 1 && p <= 65535 {
				m.publish(p)
			} else if m.input != "" {
				m.flash = m.input + " is not a TCP port"
			}
			m.input = ""
		case tea.KeyBackspace:
			if m.input != "" {
				m.input = m.input[:len(m.input)-1]
			}
		case tea.KeyRunes:
			for _, r := range k.Runes {
				if r >= '0' && r <= '9' && len(m.input) < 5 {
					m.input += string(r)
				}
			}
		}
		return m, nil
	}

	m.flash = ""
	switch k.String() {
	case "ctrl+c", "q":
		return m, tea.Quit
	case "1", "2", "3", "4", "5":
		m.section, m.content, m.cursor = section(k.String()[0]-'1'), false, 0
	case "tab", "right", "l":
		m.content = m.focusable()
	case "shift+tab", "left", "h", "esc":
		m.content = false
	case "up", "k":
		if m.content {
			m.cursor = max(m.cursor-1, 0)
		} else {
			m.section = (m.section + section(len(sections)) - 1) % section(len(sections))
			m.cursor = 0
		}
	case "down", "j":
		if m.content {
			m.cursor = min(m.cursor+1, max(m.items()-1, 0))
		} else {
			m.section = (m.section + 1) % section(len(sections))
			m.cursor = 0
		}
	case "enter", " ":
		switch {
		case !m.content:
			m.content = m.focusable()
		case m.section == ports:
			if rows := m.portRows(); m.cursor < len(rows) {
				m.publish(rows[m.cursor].port)
			}
		case m.section == settings:
			m.plan, m.planErr = m.install()
		}
	case "a":
		if m.section == ports {
			m.showAll = !m.showAll
			m.cursor = min(m.cursor, max(len(m.portRows())-1, 0))
		}
	case "n":
		if m.section == ports {
			m.adding, m.content = true, true
		}
	case "i":
		if m.section == settings {
			m.plan, m.planErr = m.install()
		}
	}
	return m, nil
}

func (m *Model) publish(port int) {
	if err := m.act.TogglePublished(port); err != nil {
		m.flash = err.Error()
	}
}

func (m Model) focusable() bool { return m.section == ports || m.section == settings }

func (m Model) items() int {
	switch m.section {
	case ports:
		return len(m.portRows())
	case settings:
		return 1
	}
	return 0
}

// Log keeps the client's last log lines for the Log section.
type Log struct {
	mu     sync.Mutex
	lines  []string
	notify func()
}

const logLines = 300

func (l *Log) Write(p []byte) (int, error) {
	l.mu.Lock()
	for line := range strings.Lines(string(p)) {
		l.lines = append(l.lines, strings.TrimRight(line, "\n"))
	}
	if len(l.lines) > logLines {
		l.lines = l.lines[len(l.lines)-logLines:]
	}
	notify := l.notify
	l.mu.Unlock()
	if notify != nil {
		notify()
	}
	return len(p), nil
}

func (l *Log) tail(n int) []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	if n <= 0 {
		return nil
	}
	return append([]string{}, l.lines[max(len(l.lines)-n, 0):]...)
}

// Client is what Run drives: the connect client and its state.
type Client interface {
	Actions
	Snapshot() connect.Snapshot
	Run(ctx context.Context) error
}

// Run shows the UI while the client runs, until the user quits or the
// client stops by itself. start makes the client with onChange as its
// Options.OnChange.
func Run(ctx context.Context, log *Log, start func(onChange func(connect.Snapshot)) (Client, error)) error {
	var latest atomic.Pointer[connect.Snapshot]
	wake := make(chan struct{}, 1)
	nudge := func() {
		select {
		case wake <- struct{}{}:
		default:
		}
	}
	cl, err := start(func(s connect.Snapshot) {
		latest.Store(&s)
		nudge()
	})
	if err != nil {
		return err
	}
	log.mu.Lock()
	log.notify = nudge
	log.mu.Unlock()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	p := tea.NewProgram(New(cl, log, cl.Snapshot()), tea.WithAltScreen(), tea.WithContext(ctx))
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-wake:
			}
			if s := latest.Swap(nil); s != nil {
				p.Send(snapMsg(*s))
			} else {
				p.Send(logMsg{})
			}
		}
	}()

	done := make(chan error, 1)
	go func() {
		err := cl.Run(ctx)
		done <- err
		p.Send(doneMsg{err})
	}()
	final, err := p.Run()
	cancel()
	runErr := <-done
	if err != nil && !errors.Is(err, tea.ErrProgramKilled) && !errors.Is(err, context.Canceled) {
		return err
	}
	if fm, ok := final.(Model); ok && fm.Err() != nil {
		return fm.Err()
	}
	return runErr
}
