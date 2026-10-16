package emulator

import (
	"context"
	"log/slog"
	"slices"
	"strings"
	"testing"
)

type fakeADB struct {
	calls  []string
	pidofs int
}

func (f *fakeADB) WaitBoot(context.Context) error {
	f.calls = append(f.calls, "wait-boot")
	return nil
}

func (f *fakeADB) Root(context.Context) error {
	f.calls = append(f.calls, "root")
	return nil
}

func (f *fakeADB) Push(_ context.Context, local, remote string) error {
	f.calls = append(f.calls, "push "+local+" "+remote)
	return nil
}

func (f *fakeADB) Shell(_ context.Context, cmd string) (string, error) {
	f.calls = append(f.calls, cmd)
	if cmd == "pidof frida-server" {
		f.pidofs++
		if f.pidofs < 2 {
			return "", nil
		}
		return "1234\n", nil
	}
	return "", nil
}

func TestPrepare(t *testing.T) {
	adb := &fakeADB{}
	e := New(DefaultConfig(), adb, slog.New(slog.DiscardHandler))
	if err := e.prepare(context.Background()); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"wait-boot",
		"root",
		"push /opt/holtdroid/frida-server /data/local/tmp/frida-server",
		"chmod 755 /data/local/tmp/frida-server && /data/local/tmp/frida-server -D </dev/null >/dev/null 2>&1",
		"pidof frida-server",
		"pidof frida-server",
	}
	if !slices.Equal(adb.calls, want) {
		t.Fatalf("calls\n%s\nwant\n%s", strings.Join(adb.calls, "\n"), strings.Join(want, "\n"))
	}
}

func TestArgs(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Args = []string{"-memory", "4096"}
	args := New(cfg, nil, nil).Args()
	if args[0] != "-avd" || args[1] != "holtdroid" || !slices.Contains(args, "swiftshader_indirect") || !slices.Equal(args[len(args)-2:], cfg.Args) {
		t.Fatalf("args %v", args)
	}
}
