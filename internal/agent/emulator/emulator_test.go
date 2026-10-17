package emulator

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
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
		allowHomeRotation,
		"dumpsys battery set level 65",
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
	args := New(cfg, nil, nil).Args(false)
	if args[0] != "-avd" || args[1] != "holtdroid" || !slices.Contains(args, "swiftshader_indirect") || !slices.Equal(args[len(args)-2:], cfg.Args) {
		t.Fatalf("args %v", args)
	}
	if host := New(cfg, nil, nil).Args(true); slices.Index(host, "host") != slices.Index(host, "-gpu")+1 {
		t.Fatalf("host gpu args %v", host)
	}
	if slices.Contains(args, "-dns-server") {
		t.Fatalf("dns server without config: %v", args)
	}
	cfg.DNSServer = "1.1.1.1"
	args = New(cfg, nil, nil).Args(false)
	if i := slices.Index(args, "-dns-server"); i < 0 || args[i+1] != "1.1.1.1" || !slices.Equal(args[len(args)-2:], cfg.Args) {
		t.Fatalf("args with dns %v", args)
	}
	if slices.Contains(args, "-cores") {
		t.Fatalf("cores without config: %v", args)
	}
	cfg.Cores, cfg.RAM = 8, 8192
	args = New(cfg, nil, nil).Args(false)
	if i := slices.Index(args, "-cores"); i < 0 || args[i+1] != "8" || args[i+2] != "-memory" || args[i+3] != "8192" {
		t.Fatalf("args with cores and ram %v", args)
	}
}

func TestDevice(t *testing.T) {
	dri := t.TempDir()
	tests := []struct {
		name  string
		gpu   string
		cards []string
		want  string
		err   bool
	}{
		{"host with a card", GPUHost, []string{"card1", "renderD128"}, "card1", false},
		{"host without a card", GPUHost, []string{"renderD128"}, "", false},
		{"software", GPUSoftware, []string{"card0"}, "", false},
		{"unknown", "vulkan", nil, "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := filepath.Join(dri, tt.name)
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			for _, c := range tt.cards {
				if err := os.WriteFile(filepath.Join(dir, c), nil, 0o644); err != nil {
					t.Fatal(err)
				}
			}
			cfg := DefaultConfig()
			cfg.GPU, cfg.DRI = tt.gpu, dir
			got, err := New(cfg, nil, slog.New(slog.DiscardHandler)).device()
			if (err != nil) != tt.err {
				t.Fatalf("err %v", err)
			}
			want := ""
			if tt.want != "" {
				want = filepath.Join(dir, tt.want)
			}
			if got != want {
				t.Fatalf("got %q want %q", got, want)
			}
		})
	}
}
