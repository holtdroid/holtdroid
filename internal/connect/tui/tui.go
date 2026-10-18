// Package tui is the holtdroid client's terminal UI: sections on the left,
// the chosen one on the right.
package tui

import (
	"context"
	"errors"
	"io"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/kriakiku/holtdroid/internal/connect"
	"github.com/kriakiku/holtdroid/internal/contract/control"
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
	SetMode(mode control.PublishMode) error
	DeviceInfo(ctx context.Context, slug string) ([]connect.Field, error)
	AppInfo(ctx context.Context, s control.Session) ([]connect.Field, error)
	Logcat(ctx context.Context, s control.Session, app bool, line func(string)) error
	Shell(slug string) (io.ReadWriteCloser, error)
	SessionURL(s control.Session) string
	Artifacts(ctx context.Context) ([]connect.Artifact, error)
	Launch(ctx context.Context, a connect.Artifact) (string, error)
	Stop(ctx context.Context, s control.Session) error
	AppAction(ctx context.Context, s control.Session, action string) error
}

type Model struct {
	snap    connect.Snapshot
	act     Actions
	log     *Log
	now     func() time.Time
	install func() (connect.Install, error)
	exe     string
	wake    func()
	openURL func(string) error
	inspect func() error
	sess    *session
	picker  *picker
	confirm *confirm

	outdated  bool
	prefs     connect.Prefs
	savePrefs func(connect.Prefs) error
	update    func() (string, error)
	restart   string

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
		exe: exe, wake: func() {}, openURL: connect.OpenURL, inspect: connect.OpenInspect, prefs: connect.LoadPrefs(), savePrefs: connect.SavePrefs,
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
		m.cursor = min(m.cursor, max(m.items()-1, 0))
		if m.sess != nil && !slices.ContainsFunc(m.snap.Sessions, func(s control.Session) bool { return s.Slug == m.sess.s.Slug }) {
			m.flash = m.sess.s.Slug + " stopped"
			m.closeSession()
		}
	case fieldsMsg, logcatEndMsg, shellDoneMsg:
		m.sessionMsg(msg)
	case artifactsMsg:
		if m.picker != nil {
			m.picker.loading, m.picker.items = false, msg.items
			if msg.err != nil {
				m.picker.err = msg.err.Error()
			}
		}
	case actionMsg:
		if msg.err != nil {
			m.flash = msg.text + ": " + msg.err.Error()
		} else {
			m.flash = msg.text
		}
	case logMsg:
	case tickMsg:
		return m, tick()
	case doneMsg:
		m.err = msg.err
		return m, tea.Quit
	case tea.KeyMsg:
		return m.key(msg)
	case tea.MouseMsg:
		return m.mouse(msg)
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

	if m.confirm != nil {
		c := m.confirm
		m.confirm = nil
		if k.String() == "y" || k.Type == tea.KeyEnter {
			m.flash = c.doing
			return m, c.run
		}
		m.flash = "cancelled"
		return m, nil
	}
	if m.picker != nil && k.String() != "ctrl+c" {
		return m.pickerKey(k)
	}
	m.flash = ""
	switch k.String() {
	case "ctrl+c", "q":
		m.closeSession()
		return m, tea.Quit
	case "1", "2", "3", "4", "5":
		m.closeSession()
		m.section, m.content, m.cursor = section(k.String()[0]-'1'), false, 0
		return m, nil
	}
	if m.sess != nil {
		return m.sessionKey(k)
	}
	switch k.String() {
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
		case m.section == devices:
			if m.cursor < len(m.snap.Sessions) {
				cmd := m.openSession(m.snap.Sessions[m.cursor])
				return m, cmd
			}
		case m.section == ports:
			if rows := m.portRows(); m.cursor < len(rows) {
				m.publish(rows[m.cursor].port)
			}
		case m.section == settings:
			return m.settingsAction()
		}
	case "o":
		if m.section == devices && m.cursor < len(m.snap.Sessions) {
			m.content = true
			m.openBrowser(m.snap.Sessions[m.cursor])
		}
	case "w":
		if m.section == devices {
			m.openInspect()
		}
	case "N":
		if m.section == devices {
			m.content = true
			return m, m.openPicker()
		}
	case "R", "I", "X":
		if m.section == devices && m.cursor < len(m.snap.Sessions) {
			m.content = true
			next, cmd, _ := m.deviceAction(k.String(), m.snap.Sessions[m.cursor])
			return next, cmd
		}
	case "m":
		if m.section == ports {
			return m.askMode(nextMode(m.mode()))
		}
	case "a":
		if m.section == ports {
			m.showAll = !m.showAll
			m.cursor = min(m.cursor, max(len(m.portRows())-1, 0))
		}
	case "n":
		if m.section == devices {
			m.content = true
			return m, m.openPicker()
		}
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

const (
	itemInstall = "install"
	itemAuto    = "auto"
	itemUpdate  = "update"
)

func (m Model) settingsItems() []string {
	items := []string{itemInstall, itemAuto}
	if m.outdated && m.update != nil {
		items = append(items, itemUpdate)
	}
	return items
}

func (m Model) settingsAction() (tea.Model, tea.Cmd) {
	items := m.settingsItems()
	if m.cursor >= len(items) {
		return m, nil
	}
	switch items[m.cursor] {
	case itemInstall:
		m.plan, m.planErr = m.install()
	case itemAuto:
		m.prefs.AutoUpdate = !m.prefs.AutoUpdate
		if err := m.savePrefs(m.prefs); err != nil {
			m.flash = err.Error()
		}
	case itemUpdate:
		path, err := m.update()
		if err != nil {
			m.flash = "update: " + err.Error()
			return m, nil
		}
		m.restart = path
		m.closeSession()
		return m, tea.Quit
	}
	return m, nil
}

// Restart is the new build to start after the UI quit for an update.
func (m Model) Restart() string { return m.restart }

func (m *Model) publish(port int) {
	if m.snap.PublishOff {
		m.flash = "publishing ports is turned off on this portal"
		return
	}
	if err := m.act.TogglePublished(port); err != nil {
		m.flash = err.Error()
	}
}

var modes = []struct {
	mode control.PublishMode
	name string
}{
	{control.PublishManual, "Manual"},
	{control.PublishDev, "Dev servers"},
	{control.PublishAll, "Everything"},
}

func (m Model) mode() control.PublishMode {
	if m.snap.Mode == "" {
		return control.PublishManual
	}
	return m.snap.Mode
}

func nextMode(mode control.PublishMode) control.PublishMode {
	for i, o := range modes {
		if o.mode == mode {
			return modes[(i+1)%len(modes)].mode
		}
	}
	return control.PublishManual
}

// askMode switches the publish mode; the automatic ones ask first, since
// they open ports nobody picked.
func (m Model) askMode(mode control.PublishMode) (Model, tea.Cmd) {
	if m.snap.PublishOff {
		m.flash = "publishing ports is turned off on this portal"
		return m, nil
	}
	if mode == m.mode() {
		return m, nil
	}
	run := m.do("publish mode", func(context.Context) (string, error) {
		return "publishing " + connect.ModeText(mode), m.act.SetMode(mode)
	})
	switch mode {
	case control.PublishDev:
		m.confirm = &confirm{
			text:  "Publish every dev server automatically? Apps on your devices reach each one as localhost.",
			doing: "publishing dev servers…", run: run,
		}
		return m, nil
	case control.PublishAll:
		m.confirm = &confirm{
			text:  "Publish every listening port, system services and apps too? Anything on your devices reaches them.",
			doing: "publishing every port…", run: run,
		}
		return m, nil
	}
	return m, run
}

func (m Model) focusable() bool {
	return m.section == ports || m.section == settings || m.section == devices && len(m.snap.Sessions) > 0
}

func (m Model) items() int {
	switch m.section {
	case devices:
		return len(m.snap.Sessions)
	case ports:
		return len(m.portRows())
	case settings:
		return len(m.settingsItems())
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

func (l *Log) reset() {
	l.mu.Lock()
	l.lines = nil
	l.mu.Unlock()
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
// Config is what the UI knows about updates when it starts.
type Config struct {
	Outdated bool
	// Update downloads the portal's build and returns its path.
	Update func() (string, error)
}

// Run returns the path of a new build when the user updated from Settings;
// the caller starts it.
func Run(ctx context.Context, log *Log, cfg Config, start func(onChange func(connect.Snapshot)) (Client, error)) (string, error) {
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
		return "", err
	}
	log.mu.Lock()
	log.notify = nudge
	log.mu.Unlock()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	m := New(cl, log, cl.Snapshot())
	m.wake = nudge
	m.outdated, m.update = cfg.Outdated, cfg.Update
	p := tea.NewProgram(m, tea.WithAltScreen(), tea.WithMouseCellMotion(), tea.WithContext(ctx))
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
		return "", err
	}
	if fm, ok := final.(Model); ok {
		if fm.Restart() != "" {
			return fm.Restart(), nil
		}
		if fm.Err() != nil {
			return "", fm.Err()
		}
	}
	return "", runErr
}
