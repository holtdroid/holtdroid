package connect

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net"
	"net/url"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"sync"

	"github.com/kriakiku/holtdroid/internal/adbproto"
	"github.com/kriakiku/holtdroid/internal/contract/control"
)

// devices are the client's own adb connections to sessions, separate from
// the local ports it forwards for the user's adb.
type devices struct {
	mu   sync.Mutex
	conn map[string]*adbproto.Client
}

func (cl *Client) device(slug string) (*adbproto.Client, error) {
	cl.devs.mu.Lock()
	defer cl.devs.mu.Unlock()
	if c := cl.devs.conn[slug]; c != nil {
		select {
		case <-c.Done():
		default:
			return c, nil
		}
	}
	sc := cl.ssh.Load()
	if sc == nil {
		return nil, errors.New("not connected")
	}
	nc, err := sc.Dial("tcp", net.JoinHostPort(slug, "5555"))
	if err != nil {
		return nil, err
	}
	c, err := adbproto.Dial(nc)
	if err != nil {
		return nil, err
	}
	if cl.devs.conn == nil {
		cl.devs.conn = map[string]*adbproto.Client{}
	}
	cl.devs.conn[slug] = c
	return c, nil
}

func (cl *Client) closeDevices() {
	cl.devs.mu.Lock()
	defer cl.devs.mu.Unlock()
	for slug, c := range cl.devs.conn {
		_ = c.Close()
		delete(cl.devs.conn, slug)
	}
}

// output runs cmd on the device and gives up when ctx ends.
func (cl *Client) output(ctx context.Context, slug, cmd string) (string, error) {
	c, err := cl.device(slug)
	if err != nil {
		return "", err
	}
	s, err := c.Open("exec:" + cmd)
	if err != nil {
		return "", err
	}
	stop := context.AfterFunc(ctx, func() { _ = s.Close() })
	defer stop()
	b, err := io.ReadAll(s)
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	return string(b), err
}

// Field is one labelled value of a device or app.
type Field struct {
	Name  string
	Value string
}

var propLine = regexp.MustCompile(`^\[(.+?)\]: \[(.*)\]$`)

func props(out string) map[string]string {
	m := map[string]string{}
	for line := range strings.Lines(out) {
		if p := propLine.FindStringSubmatch(strings.TrimSpace(line)); p != nil {
			m[p[1]] = p[2]
		}
	}
	return m
}

func after(out, prefix string) string {
	for line := range strings.Lines(out) {
		line = strings.TrimSpace(line)
		if v, ok := strings.CutPrefix(line, prefix); ok {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// DeviceInfo reads the device's model, Android version, screen and the like.
func (cl *Client) DeviceInfo(ctx context.Context, slug string) ([]Field, error) {
	out, err := cl.output(ctx, slug, "getprop")
	if err != nil {
		return nil, err
	}
	p := props(out)
	size, _ := cl.output(ctx, slug, "wm size")
	density, _ := cl.output(ctx, slug, "wm density")
	battery, _ := cl.output(ctx, slug, "dumpsys battery")
	android := p["ro.build.version.release"]
	if sdk := p["ro.build.version.sdk"]; sdk != "" {
		android += " (API " + sdk + ")"
	}
	screen := after(size, "Physical size:")
	if d := after(density, "Physical density:"); d != "" {
		screen += " · " + d + " dpi"
	}
	if level := after(battery, "level:"); level != "" {
		battery = level + "%"
	} else {
		battery = ""
	}
	locale := p["persist.sys.locale"]
	if locale == "" {
		locale = p["ro.product.locale"]
	}
	return nonEmpty([]Field{
		{"Model", strings.TrimSpace(p["ro.product.manufacturer"] + " " + p["ro.product.model"])},
		{"Android", android},
		{"ABI", strings.ReplaceAll(firstOf(p["ro.product.cpu.abilist"], p["ro.product.cpu.abi"]), ",", ", ")},
		{"Screen", strings.Trim(screen, " ·")},
		{"Battery", battery},
		{"Locale", locale},
		{"Time zone", p["persist.sys.timezone"]},
		{"Build", p["ro.build.fingerprint"]},
	}), nil
}

// AppInfo reads the session app's version and whether it runs.
func (cl *Client) AppInfo(ctx context.Context, s control.Session) ([]Field, error) {
	if s.Package == "" {
		return nil, errors.New("the session has no app")
	}
	out, err := cl.output(ctx, s.Slug, "dumpsys package "+s.Package)
	if err != nil {
		return nil, err
	}
	pid, _ := cl.output(ctx, s.Slug, "pidof "+s.Package)
	running := "no"
	if pid = strings.TrimSpace(pid); pid != "" {
		running = "yes, pid " + pid
	}
	version := after(out, "versionName=")
	if code := strings.Fields(after(out, "versionCode=")); len(code) > 0 {
		version += " (" + code[0] + ")"
	}
	target := ""
	for f := range strings.FieldsSeq(after(out, "versionCode=")) {
		if v, ok := strings.CutPrefix(f, "targetSdk="); ok {
			target = "API " + v
		}
	}
	return nonEmpty([]Field{
		{"Name", s.Label},
		{"Package", s.Package},
		{"Version", strings.TrimSpace(version)},
		{"Target", target},
		{"Running", running},
		{"UID", after(out, "appId=")},
		{"Installed", after(out, "firstInstallTime=")},
	}), nil
}

func firstOf(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func nonEmpty(fields []Field) []Field {
	out := fields[:0]
	for _, f := range fields {
		if strings.TrimSpace(f.Value) != "" {
			out = append(out, f)
		}
	}
	return out
}

// Logcat streams the device's log, the last lines first, until ctx ends.
// With app set, only the session app's process is shown.
func (cl *Client) Logcat(ctx context.Context, s control.Session, app bool, line func(string)) error {
	cmd := "logcat -v time -T 200"
	if app {
		pid, err := cl.output(ctx, s.Slug, "pidof "+s.Package)
		if err != nil {
			return err
		}
		pid = strings.TrimSpace(pid)
		if pid == "" {
			return errors.New(s.Package + " is not running")
		}
		cmd += " --pid=" + strings.Fields(pid)[0]
	}
	c, err := cl.device(s.Slug)
	if err != nil {
		return err
	}
	st, err := c.Open("exec:" + cmd)
	if err != nil {
		return err
	}
	stop := context.AfterFunc(ctx, func() { _ = st.Close() })
	defer stop()
	sc := bufio.NewScanner(st)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		line(sc.Text())
	}
	if ctx.Err() != nil {
		return nil
	}
	return sc.Err()
}

// Shell opens an interactive shell with a terminal on the device.
func (cl *Client) Shell(slug string) (io.ReadWriteCloser, error) {
	c, err := cl.device(slug)
	if err != nil {
		return nil, err
	}
	return c.Open("shell:")
}

// SessionURL is the session's page in the portal.
func (cl *Client) SessionURL(s control.Session) string {
	return strings.TrimRight(cl.opts.Portal, "/") + "/session/" + url.PathEscape(s.Provider) + "/" + url.PathEscape(s.ID)
}

// OpenURL opens u in the computer's browser.
func OpenURL(u string) error {
	name := "xdg-open"
	if runtime.GOOS == "darwin" {
		name = "open"
	}
	return exec.CommandContext(context.Background(), name, u).Start()
}
