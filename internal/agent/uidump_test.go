package agent

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const sampleDump = `UI hierchary dumped to: /data/local/tmp/holtdroid-ui-x.xml
<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="1"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.shop" content-desc="" clickable="false" bounds="[0,0][2400,1080]"><node index="0" text="" resource-id="com.example.shop:id/toolbar" class="android.view.ViewGroup" package="com.example.shop" content-desc="" clickable="false" bounds="[0,63][2400,210]"><node index="0" text="Cart   (2)" resource-id="" class="android.widget.TextView" package="com.example.shop" content-desc="" clickable="false" bounds="[48,100][400,180]" /></node><node index="1" text="" resource-id="pay" class="android.widget.Button" package="com.example.shop" content-desc="Pay now" clickable="true" bounds="[1800,900][2352,1032]" /></node></hierarchy>`

type dumpDevice struct {
	out string
	err error
}

func (d *dumpDevice) Shell(context.Context, string) (string, error) { return d.out, d.err }

func TestDumpUI(t *testing.T) {
	h, err := dumpUI(t.Context(), &dumpDevice{out: sampleDump})
	if err != nil {
		t.Fatal(err)
	}
	want := []contract.UINode{
		{Parent: -1, Class: "android.widget.FrameLayout", Package: "com.example.shop", W: 2400, H: 1080},
		{Parent: 0, Class: "android.view.ViewGroup", ResourceID: "com.example.shop:id/toolbar", Package: "com.example.shop", Y: 63, W: 2400, H: 147},
		{Parent: 1, Class: "android.widget.TextView", Text: "Cart (2)", Package: "com.example.shop", X: 48, Y: 100, W: 352, H: 80},
		{Parent: 0, Class: "android.widget.Button", ResourceID: "pay", Description: "Pay now", Package: "com.example.shop", Clickable: true, X: 1800, Y: 900, W: 552, H: 132},
	}
	if h.Rotation != 1 || len(h.Nodes) != len(want) {
		t.Fatalf("got %+v", h)
	}
	for i := range want {
		if h.Nodes[i] != want[i] {
			t.Errorf("node %d = %+v, want %+v", i, h.Nodes[i], want[i])
		}
	}
}

func TestDumpUIFails(t *testing.T) {
	for _, tc := range []struct {
		name string
		dev  *dumpDevice
		msg  string
	}{
		{"idle", &dumpDevice{out: "ERROR: could not get idle state.\n"}, "could not get idle state"},
		{"adb", &dumpDevice{err: errors.New("adb shell: device offline")}, "device offline"},
		{"empty", &dumpDevice{out: `<hierarchy rotation="0"></hierarchy>`}, "no views"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := dumpUI(t.Context(), tc.dev)
			if !errors.Is(err, contract.ErrBusy) || !strings.Contains(err.Error(), tc.msg) {
				t.Fatalf("err = %v", err)
			}
		})
	}
}
