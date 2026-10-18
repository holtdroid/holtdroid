package fake

import (
	"bufio"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/kriakiku/holtdroid/internal/adbproto"
	"github.com/kriakiku/holtdroid/internal/contract"
)

func TestHostClient(t *testing.T) {
	d := &device{s: contract.Session{Package: "com.example.shop", State: contract.StateReady}, subs: map[chan struct{}]struct{}{}, done: make(chan struct{})}
	t.Cleanup(func() { close(d.done) })
	client, server := net.Pipe()
	go d.serveADB(server)
	_ = client.SetDeadline(time.Now().Add(10 * time.Second))
	c, err := adbproto.Dial(client)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	if !strings.Contains(c.Banner, "device::") {
		t.Fatalf("banner %q", c.Banner)
	}

	for i := range 3 {
		d.log.add(logEntry{at: time.Unix(1_700_000_000, int64(i)), pid: 4200, tid: 4201, uid: fakeAppUID, prio: prioInfo, tag: "chromium", msg: "hello"})
	}
	logcat, err := c.Open("exec:logcat -v time -T 5")
	if err != nil {
		t.Fatal(err)
	}
	lines := bufio.NewScanner(logcat)
	if !lines.Scan() || lines.Text() == "" {
		t.Fatalf("logcat: %v", lines.Err())
	}

	if out, err := c.Output("getprop ro.product.model"); err != nil || out != "Fake Pixel 9\n" {
		t.Fatalf("getprop %q, %v while logcat is open", out, err)
	}
	if out, err := c.Output("dumpsys package com.example.shop"); err != nil || !strings.Contains(out, "versionName=4.2.1") {
		t.Fatalf("dumpsys %q, %v", out, err)
	}
	d.log.add(logEntry{at: time.Unix(1_700_000_100, 0), pid: 4200, tid: 4201, uid: fakeAppUID, prio: prioWarn, tag: "chromium", msg: "live line"})
	for lines.Scan() && !strings.Contains(lines.Text(), "live line") {
	}
	if !strings.Contains(lines.Text(), "live line") {
		t.Fatalf("logcat stopped: %v", lines.Err())
	}
	_ = logcat.Close()

	shell, err := c.Open("shell:")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(shell, "echo hello-from-host\nexit\n"); err != nil {
		t.Fatal(err)
	}
	out, _ := io.ReadAll(shell)
	if !strings.Contains(string(out), "hello-from-host") {
		t.Fatalf("shell printed %q", out)
	}

	if _, err := c.Open("reboot:"); err == nil {
		t.Fatal("reboot: was opened")
	}
	if out, err := c.Output("getprop ro.build.version.sdk"); err != nil || strings.TrimSpace(out) != "35" {
		t.Fatalf("after a refused service: %q, %v", out, err)
	}
}
