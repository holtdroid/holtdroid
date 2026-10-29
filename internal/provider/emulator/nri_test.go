package emulator

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/containerd/nri/pkg/api"
)

const procDevices = `Character devices:
  1 mem
 10 misc
226 drm
247 binder

Block devices:
  7 loop
247 binder
`

func TestDevicePlugin(t *testing.T) {
	gpu := func(string) (int64, int64, error) { return 226, 128, nil }
	cfg := DefaultDevicesConfig()
	cfg.Loops = 2
	p, err := newDevicePlugin(cfg, strings.NewReader(procDevices), gpu)
	if err != nil {
		t.Fatal(err)
	}
	session := map[string]string{"app.kubernetes.io/managed-by": "holtdroid-provider-emulator"}
	unprivileged := map[string]string{annotationDevices: "nri"}
	tests := []struct {
		name        string
		pod         *api.PodSandbox
		ctr         string
		wantDevices bool
	}{
		{"android", &api.PodSandbox{Name: "s", Namespace: "holtdroid", Labels: session, Annotations: unprivileged}, "android", true},
		{"agent", &api.PodSandbox{Name: "s", Namespace: "holtdroid", Labels: session, Annotations: unprivileged}, "agent", false},
		{"privileged", &api.PodSandbox{Name: "s", Namespace: "holtdroid", Labels: session}, "android", false},
		{"other namespace", &api.PodSandbox{Name: "s", Namespace: "default", Labels: session, Annotations: unprivileged}, "android", false},
		{"not a session", &api.PodSandbox{Name: "s", Namespace: "holtdroid", Annotations: unprivileged}, "android", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adj, _, err := p.CreateContainer(context.Background(), tt.pod, &api.Container{Name: tt.ctr})
			if err != nil {
				t.Fatal(err)
			}
			if (adj != nil) != tt.wantDevices {
				t.Fatalf("adjustment = %v, want devices %v", adj, tt.wantDevices)
			}
			if adj == nil {
				return
			}
			var paths []string
			for _, d := range adj.Linux.Devices {
				paths = append(paths, d.Path)
			}
			if got, want := strings.Join(paths, " "), "/dev/kmsg /dev/fuse /dev/net/tun /dev/loop-control /dev/dri/renderD128 /dev/loop0 /dev/loop1"; got != want {
				t.Errorf("devices = %s, want %s", got, want)
			}
			var rules []string
			for _, r := range adj.Linux.Resources.Devices {
				minor := "*"
				if r.Minor != nil {
					minor = strconv.FormatInt(r.Minor.Value, 10)
				}
				rules = append(rules, fmt.Sprintf("%s %d:%s", r.Type, r.Major.Value, minor))
			}
			if got, want := strings.Join(rules, " "), "c 1:3 c 10:229 c 10:200 c 10:237 c 226:128 b 7:* c 247:*"; got != want {
				t.Errorf("rules = %s, want %s", got, want)
			}
		})
	}
}

func TestDevicePluginNeedsBinder(t *testing.T) {
	_, err := newDevicePlugin(DefaultDevicesConfig(), strings.NewReader("Character devices:\n  1 mem\n"), nil)
	if err == nil || !strings.Contains(err.Error(), "CONFIG_ANDROID_BINDERFS") {
		t.Fatalf("err = %v, want a missing binder error", err)
	}
}
