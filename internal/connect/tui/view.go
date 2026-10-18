package tui

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"

	"github.com/kriakiku/holtdroid/internal/connect"
	"github.com/kriakiku/holtdroid/internal/contract/control"
)

var (
	accent  = lipgloss.Color("13")
	green   = lipgloss.Color("10")
	yellow  = lipgloss.Color("11")
	red     = lipgloss.Color("9")
	dim     = lipgloss.Color("8")
	border  = lipgloss.RoundedBorder()
	title   = lipgloss.NewStyle().Bold(true)
	muted   = lipgloss.NewStyle().Foreground(dim)
	ok      = lipgloss.NewStyle().Foreground(green)
	warn    = lipgloss.NewStyle().Foreground(yellow)
	bad     = lipgloss.NewStyle().Foreground(red)
	brand   = lipgloss.NewStyle().Foreground(accent).Bold(true)
	label   = lipgloss.NewStyle().Foreground(dim).Width(12)
	chosen  = lipgloss.NewStyle().Foreground(accent).Bold(true)
	pointer = lipgloss.NewStyle().Foreground(accent).Render("▸ ")
)

const (
	sidebarWidth = 24
	logo         = ` _   _       _ _      _           _     _
| | | | ___ | | |_ __| |_ __ ___ (_) __| |
| |_| |/ _ \| | __/ _` + "`" + ` | '__/ _ \| |/ _` + "`" + ` |
|  _  | (_) | | || (_| | | | (_) | | (_| |
|_| |_|\___/|_|\__\__,_|_|  \___/|_|\__,_|`
)

func (m Model) View() string { return stripZones(m.frame()) }

// frame is the screen with its clickable parts marked.
func (m Model) frame() string {
	height := max(m.height-1, 10)
	side := m.sidebar(height)
	contentWidth := max(m.width-sidebarWidth-2, 20)
	body := m.body(contentWidth-4, height-2)
	box := lipgloss.NewStyle().Border(border).BorderForeground(dim).Padding(0, 1).
		Width(contentWidth - 2).Height(height - 2)
	if m.content {
		box = box.BorderForeground(accent)
	}
	main := lipgloss.JoinHorizontal(lipgloss.Top, side, box.Render(clip(body, contentWidth-4, height-2)))
	return main + "\n" + m.help()
}

func (m Model) sidebar(height int) string {
	var b strings.Builder
	b.WriteString(brand.Render("holtdroid") + "\n")
	b.WriteString(m.state() + "\n\n")
	for i, name := range sections {
		count := ""
		switch section(i) {
		case devices:
			count = strconv.Itoa(len(m.snap.Sessions))
		case ports:
			count = strconv.Itoa(len(m.snap.Active))
		}
		line := fmt.Sprintf("%-10s%3s", name, count)
		switch {
		case section(i) == m.section && !m.content:
			line = pointer + chosen.Render(line)
		case section(i) == m.section:
			line = muted.Render("› ") + chosen.Render(line)
		default:
			line = "  " + line
		}
		b.WriteString(zone("sec:"+strconv.Itoa(i), line) + "\n")
	}
	return lipgloss.NewStyle().Border(border).BorderForeground(dim).Padding(0, 1).
		Width(sidebarWidth - 2).Height(height - 2).Render(strings.TrimRight(b.String(), "\n"))
}

func (m Model) state() string {
	switch {
	case m.snap.Connected:
		return ok.Render("● connected")
	case strings.HasPrefix(m.snap.Status, "reconnecting"):
		return warn.Render("○ reconnecting")
	default:
		return warn.Render("○ " + m.snap.Status)
	}
}

func (m Model) help() string {
	keys := "↑↓ move · → open · 1-5 sections · q quit"
	switch {
	case m.confirm != nil:
		answers := "  " + buttons("y yes · any other key no")
		return ansi.Truncate(warn.Render(" "+m.confirm.text), max(m.width-ansi.StringWidth(answers), 10), "…") + answers
	case m.picker != nil:
		keys = "type to filter · ↑↓ move · enter launch · esc cancel"
	case m.adding:
		keys = "type a port · enter publish · esc cancel"
	case m.content && m.section == ports && m.snap.PublishOff:
		keys = "↑↓ move · a show all · ← back · q quit"
	case m.content && m.section == ports:
		keys = "↑↓ move · space publish · n another port · a show all · m mode · ← back · q quit"
	case m.content && m.section == settings:
		keys = "↑↓ move · enter choose · ← back · q quit"
	case m.sess != nil && m.snap.ADBOff:
		keys = "R restart app · I reinstall · X stop · o browser · esc back · q quit"
	case m.sess != nil && m.sess.tab == logcatTab:
		keys = "←→ tabs · f app only · c clear · r restart log · R restart app · I reinstall · X stop · o browser · esc back"
	case m.sess != nil && m.sess.tab == shellTab:
		keys = "enter open the shell · ←→ tabs · R restart app · I reinstall · X stop · o browser · esc back"
	case m.sess != nil:
		keys = "←→ tabs · r refresh · R restart app · I reinstall · X stop · o browser · esc back"
	case m.content && m.section == devices:
		keys = "↑↓ move · enter open · N new device · R restart app · I reinstall · X stop · o browser · ← back"
	case m.section == devices:
		keys = "→ open · N new device · X stop · 1-5 sections · q quit"
	}
	line := " " + buttons(keys)
	if m.flash != "" {
		line = bad.Render(" "+m.flash) + muted.Render("  ·  ") + buttons(keys)
	}
	return ansi.Truncate(line, m.width, "…")
}

// buttons makes every "key what" hint of keys clickable as that key.
func buttons(keys string) string {
	parts := strings.Split(keys, " · ")
	for i, p := range parts {
		if k := hintKey(p); k != "" {
			parts[i] = zone("key:"+k, muted.Render(p))
		} else {
			parts[i] = muted.Render(p)
		}
	}
	return strings.Join(parts, muted.Render(" · "))
}

func hintKey(hint string) string {
	k, _, _ := strings.Cut(hint, " ")
	switch k {
	case "→":
		return "right"
	case "←":
		return "left"
	case "space":
		return " "
	case "any":
		return "n"
	case "enter", "esc":
		return k
	}
	if len(k) == 1 && (k[0] >= 'a' && k[0] <= 'z' || k[0] >= 'A' && k[0] <= 'Z') {
		return k
	}
	return ""
}

func (m Model) body(width, height int) string {
	switch m.section {
	case devices:
		if m.picker != nil {
			return m.pickerView(height)
		}
		if m.sess != nil {
			return m.sessionView(width, height)
		}
		return m.devicesView()
	case ports:
		return m.portsView(height)
	case logs:
		return m.logView(height)
	case settings:
		return m.settingsView(width)
	}
	return m.overview(width)
}

func host(portal string) string {
	if u, err := url.Parse(portal); err == nil && u.Host != "" {
		return u.Host
	}
	return portal
}

func (m Model) overview(width int) string {
	s := m.snap
	var b strings.Builder
	if width >= 44 {
		b.WriteString(brand.Render(logo) + "\n\n")
	}
	if s.Connected {
		b.WriteString(ok.Render("● Connected") + " to " + title.Render(host(s.Portal)) + "\n")
	} else {
		b.WriteString(warn.Render("○ "+capitalize(s.Status)) + " · " + title.Render(host(s.Portal)) + "\n")
	}
	if s.User != "" {
		fmt.Fprintf(&b, "  as %s on %s\n", title.Render(s.User), s.Hostname)
	}
	b.WriteString("\n")
	devs := "none running"
	if n := len(s.Sessions); n > 0 {
		devs = fmt.Sprintf("%d running", n)
	}
	b.WriteString(label.Render("Devices") + devs + "\n")
	if s.PublishOff {
		b.WriteString(label.Render("Published") + muted.Render("turned off on this portal") + "\n")
	} else {
		auto := ""
		if m.mode() != control.PublishManual {
			auto = muted.Render(" · " + connect.ModeText(m.mode()))
		}
		b.WriteString(label.Render("Published") + ports2text(s.Active) + auto + "\n")
	}
	dev := 0
	for _, p := range s.Listening {
		if connect.IsDevServer(p.Process) {
			dev++
		}
	}
	fmt.Fprintf(&b, "%s%d ports, %d look like dev servers\n", label.Render("Listening"), len(s.Listening), dev)
	if !s.CertificateExpiresAt.IsZero() {
		b.WriteString(label.Render("Certificate") + "valid for " + until(s.CertificateExpiresAt, m.now()) + muted.Render(", renewed in the background") + "\n")
	}
	if m.outdated {
		b.WriteString("\n" + warn.Render("This client is older than the portal's and may not work correctly.") + "\n" +
			muted.Render("Update it in Settings."))
	} else {
		b.WriteString("\n" + muted.Render("Pick the ports your devices reach as localhost in Ports."))
	}
	return b.String()
}

func (m Model) devicesView() string {
	s := m.snap
	var b strings.Builder
	hint := "  enter opens logcat, a shell and details · N launches a new one"
	if s.ADBOff {
		hint = "  enter opens a device · N launches a new one"
	}
	b.WriteString(title.Render("Devices") + muted.Render(hint) + "\n\n")
	if len(s.Sessions) == 0 {
		b.WriteString(zone("key:N", muted.Render("No device is running. Press N to launch one, or launch it in the portal.")))
		return b.String()
	}
	adb := map[string]connect.ADBDevice{}
	for _, a := range s.ADB {
		adb[a.Session] = a
	}
	for i, d := range s.Sessions {
		name := firstNonEmpty(d.Label, d.Package, d.Slug)
		if d.VersionName != "" {
			name += " " + d.VersionName
		}
		line := title.Render(name) + muted.Render("  "+d.Slug)
		if m.content && i == m.cursor {
			line = pointer + line
		} else {
			line = "  " + line
		}
		b.WriteString(zone(row(i), line) + "\n")
		a, ok2 := adb[d.Slug]
		switch {
		case s.ADBOff:
			b.WriteString("    " + muted.Render("ADB is turned off on this portal") + "\n\n")
			continue
		case !ok2:
			b.WriteString("    " + muted.Render("no local ADB port") + "\n\n")
			continue
		}
		state := muted.Render("adb connect it yourself")
		if a.Connected {
			state = ok.Render("✓ in adb devices")
		}
		fmt.Fprintf(&b, "    ADB 127.0.0.1:%d  %s\n\n", a.Port, state)
	}
	return strings.TrimRight(b.String(), "\n")
}

type portRow struct {
	port      int
	process   string
	listening bool
}

// portRows are the published ports and dev servers, plus every other
// listener when showAll is on.
func (m Model) portRows() []portRow {
	s := m.snap
	procs := map[int]string{}
	for _, p := range s.Listening {
		procs[p.Port] = p.Process
	}
	seen := map[int]bool{}
	var rows []portRow
	add := func(port int) {
		if seen[port] {
			return
		}
		seen[port] = true
		proc, listening := procs[port]
		rows = append(rows, portRow{port, proc, listening})
	}
	for _, p := range s.Published {
		add(p)
	}
	for _, p := range s.Listening {
		if m.showAll || connect.IsDevServer(p.Process) {
			add(p.Port)
		}
	}
	slices.SortFunc(rows, func(a, b portRow) int { return a.port - b.port })
	return rows
}

func (m Model) portsView(height int) string {
	s := m.snap
	rows := m.portRows()
	var b strings.Builder
	b.WriteString(title.Render("Ports") + muted.Render("  published ports reach every device as localhost") + "\n\n")
	if s.PublishOff {
		b.WriteString(warn.Render("Publishing ports is turned off on this portal.") + "\n\n")
	} else {
		b.WriteString(m.modeLine() + "\n\n")
	}
	if m.adding {
		b.WriteString(chosen.Render("Port to publish: ") + m.input + "█\n\n")
	}
	if len(rows) == 0 {
		b.WriteString(muted.Render("No dev server is listening. Press n to publish a port anyway.") + "\n")
	}
	visible := max(height-8, 3)
	start := 0
	if m.cursor >= visible {
		start = m.cursor - visible + 1
	}
	for i, r := range rows {
		if i < start || i >= start+visible {
			continue
		}
		mark := muted.Render("○")
		switch {
		case slices.Contains(s.Active, r.port):
			mark = ok.Render("●")
		case slices.Contains(s.Published, r.port):
			mark = warn.Render("◐")
		}
		what := r.process
		if !r.listening {
			what = muted.Render("not listening")
		}
		line := fmt.Sprintf("%s %-6d %s", mark, r.port, what)
		if slices.Contains(s.Published, r.port) && !slices.Contains(s.Pinned, r.port) && m.mode() != control.PublishManual {
			line += "  " + muted.Render("auto")
		}
		if reason, refused := s.Refused[r.port]; refused {
			line += "  " + bad.Render(reason)
		}
		if m.content && i == m.cursor {
			line = pointer + line
		} else {
			line = "  " + line
		}
		b.WriteString(zone(row(i), line) + "\n")
	}
	other := len(s.Listening) - countDev(s)
	if !m.showAll && other > 0 {
		fmt.Fprintf(&b, "\n%s", zone("key:a", muted.Render(fmt.Sprintf("%d other ports (system services, apps) · a to show", other))))
	}
	return strings.TrimRight(b.String(), "\n")
}

func (m Model) modeLine() string {
	opts := make([]string, len(modes))
	for i, o := range modes {
		if o.mode == m.mode() {
			opts[i] = zone("mode:"+string(o.mode), chosen.Render("● "+o.name))
		} else {
			opts[i] = zone("mode:"+string(o.mode), muted.Render("○ ")+o.name)
		}
	}
	return label.Render("Mode") + strings.Join(opts, "  ") + "  " + zone("key:m", muted.Render("m switches"))
}

func countDev(s connect.Snapshot) int {
	n := 0
	for _, p := range s.Listening {
		if connect.IsDevServer(p.Process) || slices.Contains(s.Published, p.Port) {
			n++
		}
	}
	return n
}

func (m Model) logView(height int) string {
	lines := m.log.tail(height - 2)
	if len(lines) == 0 {
		return title.Render("Log") + "\n\n" + muted.Render("Nothing yet.")
	}
	return title.Render("Log") + "\n\n" + strings.Join(lines, "\n")
}

func (m Model) settingsView(width int) string {
	s := m.snap
	var b strings.Builder
	field := func(name, value string) { b.WriteString(label.Render(name) + value + "\n") }
	b.WriteString(title.Render("Settings") + "\n\n")
	version := s.Version
	if version == "" {
		version = "dev"
	}
	field("Client", version)
	field("Portal", s.Portal)
	field("User", s.User)
	field("Computer", s.Hostname+muted.Render(" · "+s.Computer))
	field("Key", s.Fingerprint)
	field("Config", tilde(s.Dir))
	if m.exe != "" {
		field("Binary", tilde(m.exe))
	}
	if !s.RefreshExpiresAt.IsZero() {
		field("Enrolled", "until "+s.RefreshExpiresAt.Local().Format("2 Jan 2006")+muted.Render(", extended on every renewal"))
	}
	items := m.settingsItems()
	item := func(id, text string) {
		i := slices.Index(items, id)
		if m.content && i == m.cursor {
			text = pointer + chosen.Render(text)
		} else {
			text = "  " + text
		}
		b.WriteString(zone(row(i), text) + "\n")
	}

	b.WriteString("\n" + title.Render("The holtdroid command") + "\n")
	p := m.plan
	switch {
	case m.planErr != nil && p.Path == "":
		b.WriteString(bad.Render(m.planErr.Error()) + "\n")
	case p.Installed:
		item(itemInstall, ok.Render("✓ installed")+" "+tilde(p.Path)+muted.Render(" → "+tilde(p.Target)))
		if !p.InPath {
			b.WriteString(warn.Render("  "+filepath.Dir(tilde(p.Path))+" is not on your PATH yet; add it in your shell profile:") + "\n")
			b.WriteString("  export PATH=\"" + strings.Replace(filepath.Dir(p.Path), home(), "$HOME", 1) + ":$PATH\"\n")
		}
	default:
		item(itemInstall, "Install "+tilde(p.Path))
		if m.planErr != nil {
			b.WriteString(bad.Render("  "+m.planErr.Error()) + "\n")
		}
	}

	b.WriteString("\n" + title.Render("Updates") + "\n")
	box := "[ ]"
	if m.prefs.AutoUpdate {
		box = ok.Render("[x]")
	}
	item(itemAuto, box+" Update automatically when the portal has a newer client")
	if m.outdated {
		if m.update != nil {
			item(itemUpdate, warn.Render("Update now")+muted.Render("  the portal has a newer client; starts again"))
		} else {
			b.WriteString(warn.Render("  The portal has a newer client.") + "\n")
		}
	} else {
		b.WriteString(muted.Render("  This is the portal's current client.") + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func home() string {
	h, _ := os.UserHomeDir()
	return h
}

func tilde(path string) string {
	if h := home(); h != "" && strings.HasPrefix(path, h) {
		return "~" + strings.TrimPrefix(path, h)
	}
	return path
}

func until(t, now time.Time) string {
	d := t.Sub(now).Round(time.Minute)
	if d < time.Minute {
		return "under a minute"
	}
	return strings.TrimSuffix(d.String(), "0s")
}

func ports2text(ports []int) string {
	if len(ports) == 0 {
		return "nothing"
	}
	s := make([]string, len(ports))
	for i, p := range ports {
		s[i] = strconv.Itoa(p)
	}
	return strings.Join(s, ", ")
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// clip cuts every line to width and the text to height, so a long log
// line or port list never breaks the layout.
func clip(s string, width, height int) string {
	lines := strings.Split(s, "\n")
	if len(lines) > height {
		lines = lines[:height]
	}
	for i, l := range lines {
		lines[i] = ansi.Truncate(l, width, "…")
	}
	return strings.Join(lines, "\n")
}
