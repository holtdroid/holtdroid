package agent

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/adbproto"
	"github.com/holtdroid/holtdroid/internal/contract"
)

func echoServer(t *testing.T) string {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
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
				_, _ = io.Copy(c, c)
				c.Close()
			}()
		}
	}()
	return ln.Addr().String()
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func roundTrip(t *testing.T, c io.ReadWriter, msg string) {
	t.Helper()
	if _, err := c.Write([]byte(msg)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, len(msg))
	if _, err := io.ReadFull(c, buf); err != nil || string(buf) != msg {
		t.Fatalf("read %q, %v; want %q", buf, err, msg)
	}
}

func TestTunnels(t *testing.T) {
	dev := &fakeDevice{}
	tunnels := NewTunnels(adbTunnels{adb: dev, addr: echoServer(t)}, ShellFull, slog.New(slog.DiscardHandler))
	srv := httptest.NewServer(tunnels.Handler())
	t.Cleanup(srv.Close)
	client := contract.NewTunnelClient(srv.URL, nil)
	ctx := context.Background()

	events := make(chan contract.Tunnels, 64)
	wctx, stopWatch := context.WithCancel(ctx)
	t.Cleanup(stopWatch)
	go func() {
		_ = tunnels.Watch(wctx, false, func(s contract.Tunnels) error {
			events <- s
			return nil
		})
	}()
	if first := <-events; len(first.ADB) != 0 || len(first.Reverse) != 0 {
		t.Fatalf("first event %+v", first)
	}

	adb, err := client.ADB(ctx, "otter")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := adbproto.Connect(adb); err != nil {
		t.Fatal(err)
	}
	if s := tunnels.Snapshot(); len(s.ADB) != 1 || s.ADB[0].User != "otter" || s.ADB[0].Client != contract.ADBClientSSH {
		t.Fatalf("snapshot with adb %+v", s)
	}
	adb.Close()
	eventually(t, "the adb tunnel to close", func() bool { return len(tunnels.Snapshot().ADB) == 0 })

	sess, err := client.Reverse(ctx, 3000, "otter")
	if err != nil {
		t.Fatal(err)
	}
	local, ok := dev.reversed(3000)
	if !ok {
		t.Fatal("adb reverse was not set up")
	}
	if _, err := client.Reverse(ctx, 3000, "badger"); !isStatus(err, http.StatusConflict) {
		t.Fatalf("second reverse of the same port: %v", err)
	}

	var dialer net.Dialer
	onDevice, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(local)))
	if err != nil {
		t.Fatal(err)
	}
	stream, err := sess.AcceptStream()
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		_, _ = io.Copy(stream, stream)
		stream.Close()
	}()
	roundTrip(t, onDevice, "GET / HTTP/1.1\r\n\r\n")
	if s := tunnels.Snapshot(); len(s.Reverse) != 1 || s.Reverse[0].Port != 3000 || s.Reverse[0].Connections != 1 || s.Reverse[0].State != contract.PortUp {
		t.Fatalf("snapshot with a published port that answered %+v", s)
	}
	onDevice.Close()
	eventually(t, "the device connection to close", func() bool {
		s := tunnels.Snapshot()
		return len(s.Reverse) == 1 && s.Reverse[0].Connections == 0
	})

	sess.Close()
	eventually(t, "adb reverse --remove", func() bool { _, ok := dev.reversed(3000); return !ok })
	eventually(t, "the port to be unpublished", func() bool { return len(tunnels.Snapshot().Reverse) == 0 })

	if _, err := client.Reverse(ctx, 0, "otter"); !isStatus(err, http.StatusBadRequest) {
		t.Fatalf("port 0: %v", err)
	}

	again, err := client.Reverse(ctx, 3000, "badger")
	if err != nil {
		t.Fatal(err)
	}
	tunnels.Close()
	select {
	case <-again.CloseChan():
	case <-time.After(5 * time.Second):
		t.Fatal("Close did not drop the open tunnel")
	}
}

func TestTunnelProbes(t *testing.T) {
	tunnels := NewTunnels(adbTunnels{adb: &fakeDevice{}, addr: echoServer(t)}, ShellFull, slog.New(slog.DiscardHandler))
	tunnels.probeEvery, tunnels.probeWait = 20*time.Millisecond, 50*time.Millisecond
	srv := httptest.NewServer(tunnels.Handler())
	t.Cleanup(srv.Close)
	t.Cleanup(tunnels.Close)
	ctx := context.Background()
	sess, err := contract.NewTunnelClient(srv.URL, nil).Reverse(ctx, 3000, "otter")
	if err != nil {
		t.Fatal(err)
	}

	var refuse atomic.Bool
	var probes atomic.Int32
	refuse.Store(true)
	go func() {
		for {
			s, err := sess.AcceptStream()
			if err != nil {
				return
			}
			probes.Add(1)
			if refuse.Load() {
				s.Close()
				continue
			}
			go func() {
				_, _ = io.Copy(io.Discard, s)
				s.Close()
			}()
		}
	}()
	state := func() contract.PortState {
		if s := tunnels.Snapshot(); len(s.Reverse) == 1 {
			return s.Reverse[0].State
		}
		return ""
	}

	eventually(t, "the port to be published", func() bool { return state() == contract.PortUnknown })
	time.Sleep(100 * time.Millisecond)
	if probes.Load() != 0 {
		t.Fatal("probed with nobody watching")
	}

	wctx, stop := context.WithCancel(ctx)
	go func() { _ = tunnels.Watch(wctx, true, func(contract.Tunnels) error { return nil }) }()
	eventually(t, "a refused probe to mark the port down", func() bool { return state() == contract.PortDown })
	refuse.Store(false)
	eventually(t, "a probe kept open to mark the port up", func() bool { return state() == contract.PortUp })

	stop()
	time.Sleep(100 * time.Millisecond)
	before := probes.Load()
	time.Sleep(100 * time.Millisecond)
	if probes.Load() != before {
		t.Fatal("probing went on after the watcher left")
	}
}

func isStatus(err error, status int) bool {
	se, ok := errors.AsType[*contract.StatusError](err)
	return ok && se.Status == status
}
