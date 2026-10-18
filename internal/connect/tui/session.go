package tui

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/muesli/cancelreader"
	"golang.org/x/term"

	"github.com/kriakiku/holtdroid/internal/connect"
	"github.com/kriakiku/holtdroid/internal/contract/control"
)

type tab int

const (
	logcatTab tab = iota
	shellTab
	deviceTab
	appTab
)

var tabs = []string{"Logcat", "Shell", "Device", "App"}

// session is one device opened from the Devices section.
type session struct {
	s       control.Session
	tab     tab
	logcat  *Log
	appOnly bool
	logErr  string
	stop    context.CancelFunc
	device  []connect.Field
	devErr  string
	app     []connect.Field
	appErr  string
	loading map[tab]bool
}

type (
	fieldsMsg struct {
		slug   string
		tab    tab
		fields []connect.Field
		err    error
	}
	logcatEndMsg struct {
		slug string
		err  error
	}
	shellDoneMsg struct{ err error }
)

func (m *Model) openSession(s control.Session) tea.Cmd {
	m.closeSession()
	m.sess = &session{s: s, logcat: &Log{notify: m.wake}, loading: map[tab]bool{}}
	if m.snap.ADBOff {
		return nil
	}
	return m.startLogcat()
}

func (m *Model) closeSession() {
	if m.sess != nil && m.sess.stop != nil {
		m.sess.stop()
	}
	m.sess = nil
}

func (m *Model) startLogcat() tea.Cmd {
	ss := m.sess
	if ss.stop != nil {
		ss.stop()
	}
	ss.logcat.reset()
	ss.logErr = ""
	ctx, cancel := context.WithCancel(context.Background())
	ss.stop = cancel
	act, s, appOnly, out := m.act, ss.s, ss.appOnly, ss.logcat
	return func() tea.Msg {
		err := act.Logcat(ctx, s, appOnly, func(line string) { _, _ = out.Write([]byte(line + "\n")) })
		return logcatEndMsg{s.Slug, err}
	}
}

func (m *Model) load(t tab) tea.Cmd {
	ss := m.sess
	ss.loading[t] = true
	act, s := m.act, ss.s
	return func() tea.Msg {
		ctx := context.Background()
		var f []connect.Field
		var err error
		if t == deviceTab {
			f, err = act.DeviceInfo(ctx, s.Slug)
		} else {
			f, err = act.AppInfo(ctx, s)
		}
		return fieldsMsg{s.Slug, t, f, err}
	}
}

func (m *Model) sessionMsg(msg tea.Msg) {
	ss := m.sess
	switch msg := msg.(type) {
	case fieldsMsg:
		if ss == nil || msg.slug != ss.s.Slug {
			return
		}
		ss.loading[msg.tab] = false
		errText := ""
		if msg.err != nil {
			errText = msg.err.Error()
		}
		if msg.tab == deviceTab {
			ss.device, ss.devErr = msg.fields, errText
		} else {
			ss.app, ss.appErr = msg.fields, errText
		}
	case logcatEndMsg:
		if ss != nil && msg.slug == ss.s.Slug && msg.err != nil {
			ss.logErr = msg.err.Error()
		}
	case shellDoneMsg:
		if msg.err != nil {
			m.flash = "shell: " + msg.err.Error()
		}
	}
}

func (m Model) sessionKey(k tea.KeyMsg) (Model, tea.Cmd) {
	ss := m.sess
	if next, cmd, ok := m.deviceAction(k.String(), ss.s); ok {
		return next, cmd
	}
	switch k.String() {
	case "esc", "backspace":
		m.closeSession()
		return m, nil
	case "o":
		m.openBrowser(ss.s)
		return m, nil
	}
	if m.snap.ADBOff {
		return m, nil
	}
	switch k.String() {
	case "tab", "right", "l":
		return m.switchTab((ss.tab + 1) % tab(len(tabs)))
	case "shift+tab", "left", "h":
		return m.switchTab((ss.tab + tab(len(tabs)) - 1) % tab(len(tabs)))
	case "o":
		m.openBrowser(ss.s)
	case "f":
		if ss.tab == logcatTab && ss.s.Package != "" {
			ss.appOnly = !ss.appOnly
			return m, m.startLogcat()
		}
	case "c":
		if ss.tab == logcatTab {
			ss.logcat.reset()
		}
	case "r":
		switch ss.tab {
		case logcatTab:
			return m, m.startLogcat()
		case deviceTab, appTab:
			return m, m.load(ss.tab)
		}
	case "enter", " ":
		if ss.tab == shellTab {
			return m, tea.Exec(&shellExec{open: m.act.Shell, slug: ss.s.Slug}, func(err error) tea.Msg { return shellDoneMsg{err} })
		}
	}
	return m, nil
}

func (m Model) switchTab(t tab) (Model, tea.Cmd) {
	ss := m.sess
	ss.tab = t
	switch {
	case t == deviceTab && ss.device == nil && !ss.loading[t]:
		return m, m.load(t)
	case t == appTab && ss.app == nil && !ss.loading[t]:
		return m, m.load(t)
	}
	return m, nil
}

func (m *Model) openBrowser(s control.Session) {
	u := m.act.SessionURL(s)
	if err := m.openURL(u); err != nil {
		m.flash = "could not open " + u
	} else {
		m.flash = "opened " + u
	}
}

func (m Model) sessionView(width, height int) string {
	ss := m.sess
	s := ss.s
	var b strings.Builder
	name := firstNonEmpty(s.Label, s.Package, s.Slug)
	if s.VersionName != "" {
		name += " " + s.VersionName
	}
	b.WriteString(title.Render(name) + muted.Render(" · "+s.Slug) + "\n")
	if m.snap.ADBOff {
		b.WriteString(muted.Render(strings.Repeat("─", width)) + "\n")
		b.WriteString(warn.Render("ADB is turned off on this portal.") + "\n")
		b.WriteString("Logcat, a shell and the device's details need it.\n\n")
		b.WriteString(label.Render("R") + "restart the app\n")
		b.WriteString(label.Render("I") + "reinstall it\n")
		b.WriteString(label.Render("X") + "stop the device\n")
		b.WriteString(label.Render("o") + "open it in the browser")
		return b.String()
	}
	var bar []string
	for i, t := range tabs {
		if tab(i) == ss.tab {
			bar = append(bar, chosen.Render("["+t+"]"))
		} else {
			bar = append(bar, " "+t+" ")
		}
	}
	b.WriteString(strings.Join(bar, " ") + "\n")
	b.WriteString(muted.Render(strings.Repeat("─", width)) + "\n")
	rows := height - 3
	switch ss.tab {
	case logcatTab:
		b.WriteString(m.logcatView(rows))
	case shellTab:
		b.WriteString("A shell on the device, in this terminal.\n\n")
		b.WriteString(pointer + chosen.Render("Open the shell") + "\n\n")
		b.WriteString(muted.Render("exit or Ctrl+D brings you back here. Root on emulators."))
	case deviceTab:
		b.WriteString(fieldsView(ss.device, ss.devErr, ss.loading[deviceTab]))
	case appTab:
		b.WriteString(fieldsView(ss.app, ss.appErr, ss.loading[appTab]))
	}
	return strings.TrimRight(b.String(), "\n")
}

func (m Model) logcatView(rows int) string {
	ss := m.sess
	filter := "all processes"
	if ss.appOnly {
		filter = ss.s.Package + " only"
	}
	head := muted.Render(filter)
	if ss.logErr != "" {
		head += "  " + bad.Render(ss.logErr)
	}
	lines := ss.logcat.tail(rows - 1)
	out := make([]string, 0, len(lines)+1)
	out = append(out, head)
	for _, l := range lines {
		out = append(out, logLine(l))
	}
	if len(lines) == 0 && ss.logErr == "" {
		out = append(out, muted.Render("Waiting for the log…"))
	}
	return strings.Join(out, "\n")
}

// logLine colours a "-v time" logcat line by its priority letter.
func logLine(l string) string {
	f := strings.Fields(l)
	if len(f) < 3 || len(f[2]) < 2 || f[2][1] != '/' {
		return l
	}
	switch f[2][0] {
	case 'E', 'F':
		return bad.Render(l)
	case 'W':
		return warn.Render(l)
	case 'V', 'D':
		return muted.Render(l)
	}
	return l
}

func fieldsView(fields []connect.Field, errText string, loading bool) string {
	switch {
	case errText != "":
		return bad.Render(errText) + "\n\n" + muted.Render("r tries again")
	case loading && fields == nil:
		return muted.Render("Asking the device…")
	}
	var b strings.Builder
	for _, f := range fields {
		b.WriteString(label.Render(f.Name) + f.Value + "\n")
	}
	return b.String()
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// shellExec runs an interactive device shell on the real terminal while
// bubbletea has released it.
type shellExec struct {
	open   func(slug string) (io.ReadWriteCloser, error)
	slug   string
	stdin  io.Reader
	stdout io.Writer
}

func (e *shellExec) SetStdin(r io.Reader)  { e.stdin = r }
func (e *shellExec) SetStdout(w io.Writer) { e.stdout = w }
func (e *shellExec) SetStderr(io.Writer)   {}

func (e *shellExec) Run() error {
	conn, err := e.open(e.slug)
	if err != nil {
		return err
	}
	defer conn.Close()
	if e.stdin == nil {
		e.stdin = os.Stdin
	}
	if e.stdout == nil {
		e.stdout = os.Stdout
	}
	fmt.Fprintf(e.stdout, "Shell on %s. Type exit or press Ctrl+D to go back to holtdroid.\r\n", e.slug)
	if f, ok := e.stdin.(*os.File); ok && term.IsTerminal(int(f.Fd())) {
		old, err := term.MakeRaw(int(f.Fd()))
		if err == nil {
			defer func() { _ = term.Restore(int(f.Fd()), old) }()
		}
	}
	in, err := cancelreader.NewReader(e.stdin)
	if err != nil {
		return err
	}
	defer in.Close()
	go func() { _, _ = io.Copy(conn, in) }()
	_, _ = io.Copy(e.stdout, conn)
	in.Cancel()
	return nil
}
