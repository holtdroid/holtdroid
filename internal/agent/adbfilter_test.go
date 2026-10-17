package agent

import (
	"net"
	"testing"
	"time"

	"github.com/kriakiku/holtdroid/internal/adbproto"
)

func TestRefusedService(t *testing.T) {
	for service, refused := range map[string]bool{
		"shell:ls":          false,
		"shell,v2,pty:":     false,
		"exec:logcat -B":    false,
		"sync:":             false,
		"root:":             false,
		"reverse:forward:x": false,
		"reboot:":           true,
		"reboot:bootloader": true,
		"unroot:":           true,
		"remount:":          true,
		"tcpip:5555":        true,
		"usb:":              true,
		"sideload-host:1:2": true,
		"disable-verity:":   true,
	} {
		if got := refusedService(service); got != refused {
			t.Errorf("%q: refused %v, want %v", service, got, refused)
		}
	}
}

func TestFilterADB(t *testing.T) {
	client, clientEnd := net.Pipe()
	device, deviceEnd := net.Pipe()
	done := make(chan struct{})
	go func() {
		filterADB(clientEnd, deviceEnd)
		close(done)
	}()
	_ = client.SetDeadline(time.Now().Add(5 * time.Second))
	_ = device.SetDeadline(time.Now().Add(5 * time.Second))

	go func() {
		_ = adbproto.Write(client, adbproto.Packet{Command: adbproto.OPEN, Arg0: 3, Payload: []byte("reboot:\x00")}, 0)
	}()
	p, err := adbproto.Read(client)
	if err != nil || p.Command != adbproto.CLSE || p.Arg0 != 0 || p.Arg1 != 3 {
		t.Fatalf("refused open answered with %+v, %v", p, err)
	}

	go func() {
		_ = adbproto.Write(client, adbproto.Packet{Command: adbproto.OPEN, Arg0: 4, Payload: []byte("shell:id\x00")}, 0)
	}()
	p, err = adbproto.Read(device)
	if err != nil || p.Command != adbproto.OPEN || p.Service() != "shell:id" {
		t.Fatalf("device got %+v, %v", p, err)
	}

	go func() { _ = adbproto.Write(device, adbproto.Packet{Command: adbproto.OKAY, Arg0: 9, Arg1: 4}, 0) }()
	p, err = adbproto.Read(client)
	if err != nil || p.Command != adbproto.OKAY || p.Arg0 != 9 {
		t.Fatalf("client got %+v, %v", p, err)
	}

	_, _ = client.Write([]byte("not an adb packet at all"))
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("garbage did not end the connection")
	}
}
