package fake

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/kriakiku/holtdroid/internal/adbproto"
	"github.com/kriakiku/holtdroid/internal/contract"
)

type adbClient struct {
	t       *testing.T
	conn    net.Conn
	next    uint32
	pending []adbproto.Packet
}

func newADBClient(t *testing.T) (*adbClient, *device) {
	t.Helper()
	d := &device{s: contract.Session{Package: "com.example.shop", State: contract.StateReady}, subs: map[chan struct{}]struct{}{}, done: make(chan struct{})}
	t.Cleanup(func() { close(d.done) })
	client, server := net.Pipe()
	go d.serveADB(server)
	t.Cleanup(func() { client.Close() })
	_ = client.SetDeadline(time.Now().Add(10 * time.Second))
	banner, err := adbproto.Connect(client)
	if err != nil || !strings.Contains(banner, "shell_v2") {
		t.Fatalf("banner %q, %v", banner, err)
	}
	return &adbClient{t: t, conn: client, next: 1}, d
}

func (c *adbClient) write(p adbproto.Packet) {
	c.t.Helper()
	if err := adbproto.Write(c.conn, p, 0); err != nil {
		c.t.Fatal(err)
	}
}

func (c *adbClient) read() adbproto.Packet {
	c.t.Helper()
	if len(c.pending) > 0 {
		p := c.pending[0]
		c.pending = c.pending[1:]
		return p
	}
	p, err := adbproto.Read(c.conn)
	if err != nil {
		c.t.Fatal(err)
	}
	return p
}

// open starts a service and returns the device's id for it, or 0 when the
// device refused it.
func (c *adbClient) open(service string) (local, remote uint32) {
	c.t.Helper()
	local = c.next
	c.next++
	c.write(adbproto.Packet{Command: adbproto.OPEN, Arg0: local, Payload: []byte(service + "\x00")})
	p := c.read()
	if p.Command == adbproto.CLSE {
		return local, 0
	}
	if p.Command != adbproto.OKAY || p.Arg1 != local {
		c.t.Fatalf("open %s: %+v", service, p)
	}
	return local, p.Arg0
}

func (c *adbClient) send(local, remote uint32, data []byte) {
	c.t.Helper()
	c.write(adbproto.Packet{Command: adbproto.WRTE, Arg0: local, Arg1: remote, Payload: data})
	var early []adbproto.Packet
	for {
		p := c.read()
		if p.Command == adbproto.OKAY {
			c.pending = append(early, c.pending...)
			return
		}
		early = append(early, p)
	}
}

// drain reads until the device closes the stream, acknowledging every
// packet; with max > 0 it stops after that many bytes and closes it itself.
func (c *adbClient) drain(local, remote uint32, max int) []byte {
	c.t.Helper()
	var out []byte
	for {
		p := c.read()
		switch p.Command {
		case adbproto.WRTE:
			out = append(out, p.Payload...)
			c.write(adbproto.Packet{Command: adbproto.OKAY, Arg0: local, Arg1: remote})
			if max > 0 && len(out) >= max {
				c.write(adbproto.Packet{Command: adbproto.CLSE, Arg0: local, Arg1: remote})
				return out
			}
		case adbproto.CLSE:
			return out
		}
	}
}

func (c *adbClient) exec(cmd string) string {
	c.t.Helper()
	local, remote := c.open("exec:" + cmd)
	return string(c.drain(local, remote, 0))
}

func TestFakeADBExec(t *testing.T) {
	c, d := newADBClient(t)
	for _, tc := range []struct{ cmd, want string }{
		{"getprop ro.product.model", "Fake Pixel 9\n"},
		{"pm list packages -U com.example.shop", "package:com.example.shop uid:10234\n"},
		{"cmd settings get global sysui_demo_allowed", "null\n"},
		{"am get-standby-bucket com.example.shop", "10\n"},
	} {
		if got := c.exec(tc.cmd); got != tc.want {
			t.Errorf("%s: %q, want %q", tc.cmd, got, tc.want)
		}
	}
	c.exec("pm revoke com.example.shop android.permission.CAMERA")
	if out := c.exec("dumpsys package com.example.shop"); !strings.Contains(out, "android.permission.CAMERA: granted=false") || !strings.Contains(out, "android.permission.RECORD_AUDIO: granted=true") {
		t.Errorf("dumpsys package after revoke:\n%s", out)
	}
	c.exec("cmd webviewupdate set-webview-implementation com.android.chrome")
	if out := c.exec("dumpsys webviewupdate"); !strings.Contains(out, "(name, version): (com.android.chrome,") {
		t.Errorf("webview provider not switched:\n%s", out)
	}
	c.exec("am force-stop com.example.shop")
	if d.appRunning() {
		t.Error("force-stop left the app running")
	}
	if _, remote := c.open("reboot:"); remote != 0 {
		t.Error("unknown service accepted")
	}
}

func TestFakeADBShellV2(t *testing.T) {
	c, _ := newADBClient(t)
	local, remote := c.open("shell,v2,raw:cat /nope")
	out := c.drain(local, remote, 0)
	var stderr []byte
	exit := -1
	for len(out) >= 5 {
		n := binary.LittleEndian.Uint32(out[1:])
		data := out[5 : 5+n]
		switch out[0] {
		case shellStderr:
			stderr = append(stderr, data...)
		case shellExit:
			exit = int(data[0])
		}
		out = out[5+n:]
	}
	if exit != 1 || !strings.Contains(string(stderr), "No such file") {
		t.Fatalf("exit %d, stderr %q", exit, stderr)
	}

	local, remote = c.open("shell,v2,pty:")
	if prompt := c.drain(local, remote, 17); !bytes.Contains(prompt, []byte("# ")) {
		t.Fatalf("prompt %q", prompt)
	}
}

func syncRequest(id, arg string) []byte {
	return append(syncHeader(id, uint32(len(arg))), arg...)
}

func TestFakeADBSync(t *testing.T) {
	c, _ := newADBClient(t)
	local, remote := c.open("sync:")

	var push bytes.Buffer
	push.Write(syncRequest("SEND", "/sdcard/Download/note.txt,420"))
	push.Write(syncHeader("DATA", 5))
	push.WriteString("hello")
	push.Write(syncHeader("DONE", uint32(time.Now().Unix())))
	c.send(local, remote, push.Bytes())
	if p := c.read(); p.Command != adbproto.WRTE || string(p.Payload[:4]) != "OKAY" {
		t.Fatalf("push answered %+v", p)
	}
	c.write(adbproto.Packet{Command: adbproto.OKAY, Arg0: local, Arg1: remote})

	c.send(local, remote, syncRequest("LIST", "/sdcard/Download"))
	p := c.read()
	c.write(adbproto.Packet{Command: adbproto.OKAY, Arg0: local, Arg1: remote})
	if !bytes.Contains(p.Payload, []byte("note.txt")) || !bytes.Contains(p.Payload, []byte("test-upload.pdf")) || !bytes.Contains(p.Payload, []byte("DONE")) {
		t.Fatalf("listing %q", p.Payload)
	}

	c.send(local, remote, syncRequest("RECV", "/sdcard/Download/note.txt"))
	p = c.read()
	c.write(adbproto.Packet{Command: adbproto.OKAY, Arg0: local, Arg1: remote})
	if !bytes.Equal(p.Payload, append(append(syncHeader("DATA", 5), "hello"...), syncHeader("DONE", 0)...)) {
		t.Fatalf("pull %q", p.Payload)
	}
}

func TestFakeADBLogcat(t *testing.T) {
	c, d := newADBClient(t)
	d.log.add(logEntry{at: time.Unix(1_700_000_000, 5), pid: 4200, tid: 4201, uid: fakeAppUID, prio: prioInfo, tag: "chromium", msg: "hello"})
	out := []byte(c.exec("logcat -B -d"))
	if len(out) < 28 || binary.LittleEndian.Uint16(out[2:]) != 28 || binary.LittleEndian.Uint32(out[24:]) != fakeAppUID {
		t.Fatalf("entry header %x", out)
	}
	if payload := out[28:]; payload[0] != prioInfo || string(payload[1:]) != "chromium\x00hello\x00" {
		t.Fatalf("payload %q", payload)
	}

	c.exec("am crash com.example.shop")
	if text := c.exec("logcat -d -b crash"); !strings.Contains(text, "FATAL EXCEPTION: main") {
		t.Fatalf("crash buffer:\n%s", text)
	}
}

func TestFakeBugreport(t *testing.T) {
	b := fakeBugreport("com.example.shop", time.Now())
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil || len(zr.File) != 3 {
		t.Fatalf("zip %v, %d files", err, len(zr.File))
	}
}
