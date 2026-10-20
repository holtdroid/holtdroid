package connect

import (
	"slices"
	"testing"

	"github.com/holtdroid/holtdroid/internal/contract/control"
)

func TestAutoPublished(t *testing.T) {
	list := []control.LocalPort{
		{Port: 3000, Process: "node"},
		{Port: 5037, Process: "adb"},
		{Port: 5554, Process: "qemu-system-aarch64"},
		{Port: 5555, Process: "qemu-system-aarch64"},
		{Port: 7000, Process: "ControlCenter"},
		{Port: 8000, Process: "python3.13"},
		{Port: 15555, Process: "holtdroid-6557e34d"},
		{Port: 20000, Process: ""},
	}
	for _, tc := range []struct {
		mode control.PublishMode
		want []int
	}{
		{control.PublishManual, nil},
		{"", nil},
		{control.PublishDev, []int{3000, 8000}},
		{control.PublishAll, []int{3000, 7000, 8000, 20000}},
	} {
		if got := autoPublished(tc.mode, list); !slices.Equal(got, tc.want) {
			t.Errorf("%q: %v, want %v", tc.mode, got, tc.want)
		}
	}
}

func TestWantedAndToggle(t *testing.T) {
	cl := &Client{st: state{Published: []int{9000, 3000}, Mode: control.PublishDev}, listening: []control.LocalPort{
		{Port: 3000, Process: "node"}, {Port: 5173, Process: "vite"}, {Port: 5037, Process: "adb"},
	}}
	if got := cl.wanted(); !slices.Equal(got, []int{3000, 5173, 9000}) {
		t.Fatalf("wanted %v", got)
	}
	if err := cl.TogglePublished(5173); err == nil {
		t.Fatal("unpublished a port the mode publishes")
	}
}
