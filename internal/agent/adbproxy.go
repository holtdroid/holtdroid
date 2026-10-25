package agent

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/adbproto"
)

// ShellPolicy says which shell commands users may run through the ADB proxy.
type ShellPolicy string

const (
	ShellFull      ShellPolicy = "full"
	ShellAllowlist ShellPolicy = "allowlist"
	ShellOff       ShellPolicy = "off"
)

func (p ShellPolicy) Validate() error {
	switch p {
	case ShellFull, ShellAllowlist, ShellOff:
		return nil
	}
	return fmt.Errorf("adb.shell must be full, allowlist or off, not %q", p)
}

// passiveServices carry no commands: file transfer, debuggers and forwards.
var passiveServices = []string{
	"sync:", "jdwp:", "track-jdwp", "track-app", "framebuffer:",
	"tcp:", "localabstract:", "localreserved:", "localfilesystem:",
}

var fridaForward = regexp.MustCompile(`^tcp:(.*:)?2704[23]$`)

// proxyRefused are refused by the proxy on top of refusedServices: root
// for the user, reverse forwards (the device would reach the provider's
// host instead of the user) and frida-server.
func proxyRefused(service string) bool {
	return service == "root:" || strings.HasPrefix(service, "reverse:") || fridaForward.MatchString(service)
}

func (p ShellPolicy) allows(service string) bool {
	if refusedService(service) || proxyRefused(service) {
		return false
	}
	if p == ShellFull {
		return true
	}
	if cmd, ok := shellCommand(service); ok {
		return p == ShellAllowlist && allowedCommand(cmd)
	}
	for _, prefix := range []string{"abb_exec:", "abb:"} {
		if args, ok := strings.CutPrefix(service, prefix); ok {
			return p == ShellAllowlist && allowedPackageCommand(strings.Split(args, "\x00"))
		}
	}
	return slices.ContainsFunc(passiveServices, func(prefix string) bool { return strings.HasPrefix(service, prefix) })
}

// allowsDirect is the policy for a client speaking to adbd itself (redroid):
// with the full policy only the refused services are off, as the agent's own
// adb needs nothing else; otherwise commands follow the proxy's rules.
func (p ShellPolicy) allowsDirect(service string) bool {
	if p == ShellFull {
		return !refusedService(service)
	}
	return p.allows(service)
}

func shellCommand(service string) (string, bool) {
	if cmd, ok := strings.CutPrefix(service, "exec:"); ok {
		return cmd, true
	}
	name, cmd, _ := strings.Cut(service, ":")
	if name == "shell" || strings.HasPrefix(name, "shell,") {
		return cmd, true
	}
	return "", false
}

func allowedCommand(cmd string) bool {
	argv, ok := splitWords(cmd)
	if !ok || len(argv) == 0 {
		return false
	}
	switch strings.TrimPrefix(argv[0], "/system/bin/") {
	case "getprop", "logcat", "am":
		return true
	case "pm":
		return allowedPM(argv[1:])
	case "cmd":
		return allowedPackageCommand(argv[1:])
	case "settings":
		return len(argv) > 1 && argv[1] == "get"
	case "dumpsys":
		return allowedDumpsys(argv[1:])
	}
	return false
}

func allowedPackageCommand(args []string) bool {
	switch {
	case len(args) > 1 && args[0] == "package":
		return allowedPM(args[1:])
	case len(args) > 1 && args[0] == "settings":
		return args[1] == "get"
	}
	return false
}

// allowedDumpsys lets the session page's read-only views through; dumpsys
// with other arguments can change the device (battery set, force-idle).
func allowedDumpsys(args []string) bool {
	switch {
	case len(args) == 1:
		return slices.Contains([]string{"battery", "webviewupdate", "package"}, args[0])
	case len(args) == 2 && args[0] == "package":
		return true
	case len(args) == 3 && args[0] == "deviceidle" && args[1] == "get":
		return true
	}
	return false
}

func allowedPM(args []string) bool {
	return len(args) > 0 && (args[0] == "list" || installCommand(args[0]))
}

func installCommand(sub string) bool {
	return slices.Contains([]string{"install", "install-create", "install-write", "install-commit", "install-abandon"}, sub)
}

// splitWords splits a command the way the device's sh would, refusing
// anything that could run a second command or expand into one.
func splitWords(s string) ([]string, bool) {
	var words []string
	var cur strings.Builder
	inWord := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == ' ' || c == '\t':
			if inWord {
				words = append(words, cur.String())
				cur.Reset()
				inWord = false
			}
			continue
		case c == '\'':
			j := strings.IndexByte(s[i+1:], '\'')
			if j < 0 {
				return nil, false
			}
			cur.WriteString(s[i+1 : i+1+j])
			i += j + 1
		case c == '"':
			j := strings.IndexByte(s[i+1:], '"')
			if j < 0 || strings.ContainsAny(s[i+1:i+1+j], "$`\\") {
				return nil, false
			}
			cur.WriteString(s[i+1 : i+1+j])
			i += j + 1
		case c == '\\':
			if i+1 >= len(s) || s[i+1] == '\n' {
				return nil, false
			}
			i++
			cur.WriteByte(s[i])
		case strings.IndexByte(";&|<>()$`\n\r{}", c) >= 0:
			return nil, false
		default:
			cur.WriteByte(c)
		}
		inWord = true
	}
	if inWord {
		words = append(words, cur.String())
	}
	return words, true
}

const proxyMaxPayload = 256 << 10

// ADBProxy is the device side of the adb protocol for a device reached
// through the host's adb server: it accepts any client without AUTH (the
// gateway or the session proxy authenticated the user), checks every OPEN
// and replays allowed services as `host:transport:<serial>` connections.
type ADBProxy struct {
	server adbServer
	shell  ShellPolicy
	log    *slog.Logger
}

// NewADBProxy serves serial from the adb server at addr (host:port).
func NewADBProxy(addr, serial string, shell ShellPolicy, log *slog.Logger) *ADBProxy {
	return &ADBProxy{server: adbServer{addr: addr, serial: serial}, shell: shell, log: log}
}

// Dial checks the device is there and serves one client on the other end
// of the returned connection.
func (p *ADBProxy) Dial(ctx context.Context) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	banner, err := p.banner(ctx)
	if err != nil {
		return nil, err
	}
	client, device := net.Pipe()
	go p.serve(device, banner)
	return client, nil
}

var bannerProps = []string{"ro.product.name", "ro.product.model", "ro.product.device"}

func (p *ADBProxy) banner(ctx context.Context) (string, error) {
	features, err := p.server.Features(ctx)
	if err != nil {
		return "", err
	}
	kept := slices.DeleteFunc(strings.Split(features, ","), func(f string) bool { return f == "" || f == "delayed_ack" })
	props := map[string]string{}
	if c, err := p.server.Open(ctx, "exec:getprop"); err == nil {
		out, _ := io.ReadAll(c)
		c.Close()
		for line := range strings.SplitSeq(string(out), "\n") {
			if m := propLine.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
				props[m[1]] = m[2]
			}
		}
	}
	var b strings.Builder
	b.WriteString("device::")
	for _, k := range bannerProps {
		if v := props[k]; v != "" {
			fmt.Fprintf(&b, "%s=%s;", k, v)
		}
	}
	b.WriteString("features=" + strings.Join(kept, ","))
	return b.String(), nil
}

var propLine = regexp.MustCompile(`^\[([^\]]+)\]: \[(.*)\]$`)

type proxyConn struct {
	p    *ADBProxy
	conn net.Conn
	ctx  context.Context
	max  int

	wmu sync.Mutex

	mu      sync.Mutex
	next    uint32
	streams map[uint32]*proxyStream
}

func (p *ADBProxy) serve(conn net.Conn, banner string) {
	defer conn.Close()
	hello, err := adbproto.Read(conn)
	if err != nil || hello.Command != adbproto.CNXN {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	pc := &proxyConn{p: p, conn: conn, ctx: ctx, max: proxyMaxPayload, next: 1, streams: map[uint32]*proxyStream{}}
	defer pc.closeAll()
	defer cancel()
	if hello.Arg1 > 0 && int(hello.Arg1) < pc.max {
		pc.max = int(hello.Arg1)
	}
	if pc.send(adbproto.Packet{Command: adbproto.CNXN, Arg0: adbproto.Version, Arg1: proxyMaxPayload, Payload: []byte(banner)}) != nil {
		return
	}
	for {
		pkt, err := adbproto.Read(conn)
		if err != nil {
			return
		}
		switch pkt.Command {
		case adbproto.OPEN:
			go pc.open(pkt.Arg0, pkt.Service())
		case adbproto.OKAY:
			if s := pc.stream(pkt.Arg1); s != nil {
				select {
				case s.ack <- struct{}{}:
				default:
				}
			}
		case adbproto.WRTE:
			if s := pc.stream(pkt.Arg1); s != nil {
				select {
				case s.in <- pkt.Payload:
				default:
					s.finish(true)
				}
			}
		case adbproto.CLSE:
			if s := pc.stream(pkt.Arg1); s != nil {
				s.finish(false)
			}
		}
	}
}

func (pc *proxyConn) send(p adbproto.Packet) error {
	pc.wmu.Lock()
	defer pc.wmu.Unlock()
	return adbproto.Write(pc.conn, p, 0)
}

func (pc *proxyConn) stream(id uint32) *proxyStream {
	pc.mu.Lock()
	defer pc.mu.Unlock()
	return pc.streams[id]
}

func (pc *proxyConn) closeAll() {
	pc.mu.Lock()
	streams := make([]*proxyStream, 0, len(pc.streams))
	for _, s := range pc.streams {
		streams = append(streams, s)
	}
	pc.mu.Unlock()
	for _, s := range streams {
		s.finish(false)
	}
}

func (pc *proxyConn) open(remote uint32, service string) {
	refuse := func() { _ = pc.send(adbproto.Packet{Command: adbproto.CLSE, Arg1: remote}) }
	if !pc.p.shell.allows(service) {
		pc.p.log.Info("adb service refused", "service", service)
		refuse()
		return
	}
	ctx, cancel := context.WithTimeout(pc.ctx, 30*time.Second)
	sock, err := pc.p.server.Open(ctx, service)
	cancel()
	if err != nil {
		refuse()
		return
	}
	pc.mu.Lock()
	s := &proxyStream{pc: pc, local: pc.next, remote: remote, sock: sock, ack: make(chan struct{}, 1), in: make(chan []byte, 1), done: make(chan struct{})}
	pc.next++
	pc.streams[s.local] = s
	pc.mu.Unlock()
	if pc.ctx.Err() != nil || pc.send(adbproto.Packet{Command: adbproto.OKAY, Arg0: s.local, Arg1: remote}) != nil {
		s.finish(false)
		return
	}
	go s.down()
	go s.up()
}

// proxyStream is one service: the client's WRTEs go to the adb server's
// socket, acknowledged once written, and what the socket returns goes back
// one WRTE at a time, each waiting for the client's OKAY.
type proxyStream struct {
	pc            *proxyConn
	local, remote uint32
	sock          net.Conn
	ack           chan struct{}
	in            chan []byte
	done          chan struct{}
	once          sync.Once
}

func (s *proxyStream) down() {
	buf := make([]byte, s.pc.max)
	for {
		n, err := s.sock.Read(buf)
		if n > 0 {
			if s.pc.send(adbproto.Packet{Command: adbproto.WRTE, Arg0: s.local, Arg1: s.remote, Payload: bytes.Clone(buf[:n])}) != nil {
				break
			}
			select {
			case <-s.ack:
			case <-s.done:
				return
			}
		}
		if err != nil {
			break
		}
	}
	s.finish(true)
}

func (s *proxyStream) up() {
	for {
		select {
		case b := <-s.in:
			if _, err := s.sock.Write(b); err != nil {
				s.finish(true)
				return
			}
			if s.pc.send(adbproto.Packet{Command: adbproto.OKAY, Arg0: s.local, Arg1: s.remote}) != nil {
				return
			}
		case <-s.done:
			return
		}
	}
}

func (s *proxyStream) finish(notify bool) {
	s.once.Do(func() {
		close(s.done)
		s.sock.Close()
		s.pc.mu.Lock()
		delete(s.pc.streams, s.local)
		s.pc.mu.Unlock()
		if notify {
			_ = s.pc.send(adbproto.Packet{Command: adbproto.CLSE, Arg0: s.local, Arg1: s.remote})
		}
	})
}
