package agent

import (
	"io"
	"strings"
	"sync"

	"github.com/holtdroid/holtdroid/internal/adbproto"
)

// refusedServices restart adbd or the device, or move adb off this port;
// any of them would cut the agent off its own device.
var refusedServices = []string{
	"reboot:", "unroot:", "remount:", "tcpip:", "usb:", "sideload:", "sideload-host:",
	"enable-verity:", "disable-verity:",
}

func refusedService(service string) bool {
	for _, prefix := range refusedServices {
		if strings.HasPrefix(service, prefix) || service+":" == prefix {
			return true
		}
	}
	return false
}

const wsChunk = 64 << 10

// filterADB relays adb packets between a client and adbd and answers OPENs
// of refused services with CLSE itself. Anything that isn't a well-formed
// packet ends the connection.
func filterADB(client, device io.ReadWriteCloser) {
	var mu sync.Mutex
	toClient := func(p adbproto.Packet) error {
		mu.Lock()
		defer mu.Unlock()
		return adbproto.Write(client, p, wsChunk)
	}
	done := make(chan struct{}, 2)
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			p, err := adbproto.Read(device)
			if err != nil || toClient(p) != nil {
				return
			}
		}
	}()
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			p, err := adbproto.Read(client)
			if err != nil {
				return
			}
			if p.Command == adbproto.OPEN && refusedService(p.Service()) {
				if toClient(adbproto.Packet{Command: adbproto.CLSE, Arg1: p.Arg0}) != nil {
					return
				}
				continue
			}
			if adbproto.Write(device, p, 0) != nil {
				return
			}
		}
	}()
	<-done
	client.Close()
	device.Close()
	<-done
}
