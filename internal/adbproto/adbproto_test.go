package adbproto

import (
	"bytes"
	"encoding/binary"
	"io"
	"strings"
	"testing"
)

type countingWriter struct {
	bytes.Buffer
	writes []int
}

func (w *countingWriter) Write(b []byte) (int, error) {
	w.writes = append(w.writes, len(b))
	return w.Buffer.Write(b)
}

func TestRoundTrip(t *testing.T) {
	for _, tc := range []struct {
		name   string
		p      Packet
		chunk  int
		writes int
	}{
		{"empty", Packet{Command: OKAY, Arg0: 1, Arg1: 2}, 0, 1},
		{"open", Packet{Command: OPEN, Arg0: 7, Payload: []byte("shell:ls\x00")}, 0, 1},
		{"chunked", Packet{Command: WRTE, Arg0: 1, Arg1: 2, Payload: bytes.Repeat([]byte{1}, 100)}, 50, 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var w countingWriter
			if err := Write(&w, tc.p, tc.chunk); err != nil {
				t.Fatal(err)
			}
			if len(w.writes) != tc.writes {
				t.Fatalf("%d writes, want %d", len(w.writes), tc.writes)
			}
			got, err := Read(&w.Buffer)
			if err != nil {
				t.Fatal(err)
			}
			if got.Command != tc.p.Command || got.Arg0 != tc.p.Arg0 || got.Arg1 != tc.p.Arg1 || !bytes.Equal(got.Payload, tc.p.Payload) {
				t.Fatalf("got %+v, want %+v", got, tc.p)
			}
		})
	}
}

func TestService(t *testing.T) {
	if s := (Packet{Payload: []byte("reboot:\x00")}).Service(); s != "reboot:" {
		t.Fatalf("service %q", s)
	}
}

func TestReadRejects(t *testing.T) {
	bad := Marshal(Packet{Command: CNXN})
	binary.LittleEndian.PutUint32(bad[20:], 0)
	huge := Marshal(Packet{Command: WRTE})
	binary.LittleEndian.PutUint32(huge[12:], MaxPayload+1)
	for name, b := range map[string][]byte{"magic": bad, "payload": huge, "short": bad[:10]} {
		if _, err := Read(bytes.NewReader(b)); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}

func TestConnect(t *testing.T) {
	var reply bytes.Buffer
	_ = Write(&reply, Packet{Command: CNXN, Arg0: Version, Arg1: 4096, Payload: []byte("device::features=shell_v2")}, 0)
	var sentBuf strings.Builder
	rw := struct {
		io.Reader
		io.Writer
	}{&reply, &sentBuf}
	banner, err := Connect(rw)
	if err != nil || banner != "device::features=shell_v2" {
		t.Fatalf("banner %q, %v", banner, err)
	}
	sent, err := Read(strings.NewReader(sentBuf.String()))
	if err != nil || sent.Command != CNXN || sent.Service() != "host::" {
		t.Fatalf("sent %+v, %v", sent, err)
	}
}
