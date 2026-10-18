package fake

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/kriakiku/holtdroid/internal/adbproto"
	"github.com/kriakiku/holtdroid/internal/agent"
	"github.com/kriakiku/holtdroid/internal/contract"
)

const proxySerial = "FAKE0001"

// hostADBServer is a host adb server with one fake device attached: it
// answers features and transport requests and splices services to it.
func hostADBServer(t *testing.T, d *device) string {
	t.Helper()
	client, server := net.Pipe()
	go d.serveADB(server)
	dev, err := adbproto.Dial(client)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = dev.Close() })
	_, features, _ := strings.Cut(dev.Banner, "features=")
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go serveHostRequest(c, dev, "delayed_ack,"+features)
		}
	}()
	return ln.Addr().String()
}

func readRequest(c net.Conn) (string, error) {
	var size [4]byte
	if _, err := io.ReadFull(c, size[:]); err != nil {
		return "", err
	}
	n, err := strconv.ParseUint(string(size[:]), 16, 16)
	if err != nil {
		return "", err
	}
	b := make([]byte, n)
	_, err = io.ReadFull(c, b)
	return string(b), err
}

func reply(c net.Conn, status, msg string) {
	_, _ = fmt.Fprintf(c, "%s%04x%s", status, len(msg), msg)
}

func serveHostRequest(c net.Conn, dev *adbproto.Client, features string) {
	req, err := readRequest(c)
	switch {
	case err != nil:
		c.Close()
		return
	case req == "host-serial:"+proxySerial+":features":
		reply(c, "OKAY", features)
		c.Close()
		return
	case req != "host:transport:"+proxySerial:
		reply(c, "FAIL", "device '"+strings.TrimPrefix(req, "host:transport:")+"' not found")
		c.Close()
		return
	}
	_, _ = io.WriteString(c, "OKAY")
	service, err := readRequest(c)
	if err != nil {
		c.Close()
		return
	}
	s, err := dev.Open(service)
	if err != nil {
		reply(c, "FAIL", "closed")
		c.Close()
		return
	}
	_, _ = io.WriteString(c, "OKAY")
	go func() {
		_, _ = io.Copy(s, c)
		_ = s.Close()
	}()
	_, _ = io.Copy(c, s)
	c.Close()
}

func proxyDevice(t *testing.T) *device {
	d := &device{s: contract.Session{Package: "com.example.shop", State: contract.StateReady}, subs: map[chan struct{}]struct{}{}, done: make(chan struct{})}
	t.Cleanup(func() { close(d.done) })
	return d
}

func syncPacket(id string, payload []byte) []byte {
	b := make([]byte, 8, 8+len(payload))
	copy(b, id)
	binary.LittleEndian.PutUint32(b[4:], uint32(len(payload)))
	return append(b, payload...)
}

func TestADBProxy(t *testing.T) {
	addr := hostADBServer(t, proxyDevice(t))
	proxy := agent.NewADBProxy(addr, proxySerial, agent.ShellAllowlist, slog.New(slog.DiscardHandler))
	conn, err := proxy.Dial(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	c, err := adbproto.Dial(conn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	if !strings.Contains(c.Banner, "ro.product.model=Fake Pixel 9;") || !strings.Contains(c.Banner, "shell_v2") || strings.Contains(c.Banner, "delayed_ack") {
		t.Fatalf("banner %q", c.Banner)
	}

	logcat, err := c.Open("exec:logcat -v time -T 5")
	if err != nil {
		t.Fatal(err)
	}
	if out, err := c.Output("getprop ro.product.model"); err != nil || out != "Fake Pixel 9\n" {
		t.Fatalf("getprop %q, %v while logcat is open", out, err)
	}
	_ = logcat.Close()

	for _, service := range []string{"shell:", "exec:ls /", "root:", "reboot:bootloader", "reverse:forward:tcp:1;tcp:1", "tcp:27042"} {
		if _, err := c.Open(service); err == nil {
			t.Errorf("%q was opened", service)
		}
	}
	if out, err := c.Output("pm list packages com.example.shop"); err != nil || !strings.Contains(out, "package:com.example.shop") {
		t.Fatalf("after refused services: %q, %v", out, err)
	}

	data := bytes.Repeat([]byte("0123456789abcdef"), 200_000)
	s, err := c.Open("sync:")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		w := bufio.NewWriterSize(s, 64<<10)
		_, _ = w.Write(syncPacket("SEND", []byte("/sdcard/Download/big.bin,33188")))
		for rest := data; len(rest) > 0; {
			n := min(len(rest), 64<<10)
			_, _ = w.Write(syncPacket("DATA", rest[:n]))
			rest = rest[n:]
		}
		_, _ = w.Write(syncHeaderDone())
		_, _ = w.Write(syncPacket("RECV", []byte("/sdcard/Download/big.bin")))
		_ = w.Flush()
	}()
	r := bufio.NewReader(s)
	var h [8]byte
	if _, err := io.ReadFull(r, h[:]); err != nil || string(h[:4]) != "OKAY" {
		t.Fatalf("SEND answered %q, %v", h, err)
	}
	var got bytes.Buffer
	for {
		if _, err := io.ReadFull(r, h[:]); err != nil {
			t.Fatal(err)
		}
		if string(h[:4]) == "DONE" {
			break
		}
		if _, err := io.CopyN(&got, r, int64(binary.LittleEndian.Uint32(h[4:]))); err != nil {
			t.Fatal(err)
		}
	}
	if !bytes.Equal(got.Bytes(), data) {
		t.Fatalf("pulled %d bytes, pushed %d", got.Len(), len(data))
	}
	_ = s.Close()
}

func syncHeaderDone() []byte {
	b := syncPacket("DONE", nil)
	binary.LittleEndian.PutUint32(b[4:], uint32(time.Now().Unix()))
	return b
}

func TestADBProxyShellOff(t *testing.T) {
	addr := hostADBServer(t, proxyDevice(t))
	conn, err := agent.NewADBProxy(addr, proxySerial, agent.ShellOff, slog.New(slog.DiscardHandler)).Dial(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	c, err := adbproto.Dial(conn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	if _, err := c.Output("getprop ro.product.model"); err == nil {
		t.Fatal("exec: was opened with shell off")
	}
	s, err := c.Open("sync:")
	if err != nil {
		t.Fatal(err)
	}
	_ = s.Close()

	if _, err := agent.NewADBProxy(addr, "MISSING", agent.ShellOff, slog.New(slog.DiscardHandler)).Dial(t.Context()); err == nil {
		t.Fatal("a missing device was dialed")
	}
}

// TestADBProxyRealClient puts a real adb server in front of the proxy, the
// way a holtdroid client's local adb reaches a phone.
func TestADBProxyRealClient(t *testing.T) {
	bin, err := exec.LookPath("adb")
	if err != nil || testing.Short() {
		t.Skip("needs adb from platform-tools")
	}
	addr := hostADBServer(t, proxyDevice(t))
	proxy := agent.NewADBProxy(addr, proxySerial, agent.ShellAllowlist, slog.New(slog.DiscardHandler))
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				dev, err := proxy.Dial(context.Background())
				if err != nil {
					c.Close()
					return
				}
				contract.Splice(c.(*net.TCPConn), dev, nil)
			}()
		}
	}()

	free, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := strconv.Itoa(free.Addr().(*net.TCPAddr).Port)
	free.Close()
	home := t.TempDir()
	device := ln.Addr().String()
	adb := func(args ...string) (string, error) {
		ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, bin, append([]string{"-P", port}, args...)...)
		cmd.Env = append(os.Environ(), "HOME="+home, "ANDROID_USER_HOME="+filepath.Join(home, ".android"))
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	t.Cleanup(func() { _, _ = adb("kill-server") })
	if out, err := adb("connect", device); err != nil || !strings.Contains(out, "connected") {
		t.Fatalf("connect: %s, %v", out, err)
	}
	if out, err := adb("-s", device, "wait-for-device", "shell", "getprop", "ro.product.model"); err != nil || strings.TrimSpace(out) != "Fake Pixel 9" {
		t.Fatalf("getprop: %q, %v", out, err)
	}
	if out, err := adb("-s", device, "shell", "ls", "/"); err == nil {
		t.Fatalf("ls was allowed: %q", out)
	}
	local := filepath.Join(home, "hello.txt")
	if err := os.WriteFile(local, []byte("hello through the proxy"), 0o644); err != nil {
		t.Fatal(err)
	}
	if out, err := adb("-s", device, "push", local, "/sdcard/Download/hello.txt"); err != nil {
		t.Fatalf("push: %s, %v", out, err)
	}
	back := filepath.Join(home, "back.txt")
	if out, err := adb("-s", device, "pull", "/sdcard/Download/hello.txt", back); err != nil {
		t.Fatalf("pull: %s, %v", out, err)
	}
	if b, _ := os.ReadFile(back); string(b) != "hello through the proxy" {
		t.Fatalf("pulled %q", b)
	}
	if out, err := adb("-s", device, "reboot", "bootloader"); err == nil {
		t.Fatalf("reboot bootloader went through: %q", out)
	}
}
