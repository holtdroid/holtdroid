package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/holtdroid/holtdroid/internal/adbproto"
	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/provider/fake"
)

func (h *harness) dialADB(srv *httptest.Server, id, user, groups string) (*websocket.Conn, int) {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ws, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/s/fake/"+id+"/adb", &websocket.DialOptions{
		HTTPHeader: http.Header{"Remote-User": {user}, "Remote-Groups": {groups}, "X-Holtdroid-User": {"spoofed"}, "Origin": {"https://android.example.com"}},
	})
	if err != nil {
		if resp == nil {
			h.t.Fatal(err)
		}
		return nil, resp.StatusCode
	}
	return ws, resp.StatusCode
}

func TestBrowserADB(t *testing.T) {
	h := newHarness(t, 2, func(c *fake.Config) { c.StepDelay = time.Millisecond })
	srv := httptest.NewServer(h.handler)
	t.Cleanup(srv.Close)
	v := h.create("otter")
	h.waitReady(v.ID)

	info := decode[ADBInfo](t, h.do(http.MethodGet, "/api/v1/adb", "otter", "", nil))
	if !info.Browser || !info.OwnerOnly {
		t.Fatalf("info %+v", info)
	}

	h.srv.cfg.ADB.OwnerOnly = false

	ws, code := h.dialADB(srv, v.ID, "beaver", "")
	if ws == nil {
		t.Fatalf("dial: %d", code)
	}
	conn := websocket.NetConn(context.Background(), ws, websocket.MessageBinary)
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	if banner, err := adbproto.Connect(conn); err != nil || !strings.HasPrefix(banner, "device::") {
		t.Fatalf("banner %q, %v", banner, err)
	}
	if err := adbproto.Write(conn, adbproto.Packet{Command: adbproto.OPEN, Arg0: 1, Payload: []byte("reboot:\x00")}, 0); err != nil {
		t.Fatal(err)
	}
	if p, err := adbproto.Read(conn); err != nil || p.Command != adbproto.CLSE || p.Arg1 != 1 {
		t.Fatalf("reboot answered %+v, %v", p, err)
	}
	conn.Close()
	eventually(t, "adb.disconnect", func() bool {
		events, _ := h.srv.audit.Store().Query(audit.Query{Actions: []string{string(audit.ADBDisconnect)}, Actor: "beaver"})
		return len(events) == 1
	})

	h.srv.cfg.ADB.OwnerOnly = true
	if _, code := h.dialADB(srv, v.ID, "beaver", ""); code != http.StatusForbidden {
		t.Fatalf("stranger with ownerOnly: %d", code)
	}
	for _, who := range [][2]string{{"otter", ""}, {"root", "admins"}} {
		ws, code := h.dialADB(srv, v.ID, who[0], who[1])
		if ws == nil {
			t.Fatalf("%s with ownerOnly: %d", who[0], code)
		}
		_ = ws.CloseNow()
	}

	h.srv.cfg.ADB.Browser = false
	if _, code := h.dialADB(srv, v.ID, "otter", ""); code != http.StatusForbidden {
		t.Fatalf("browser ADB off: %d", code)
	}
	if _, code := h.dialADB(srv, "missing", "otter", ""); code != http.StatusNotFound {
		t.Fatalf("missing session: %d", code)
	}

	var got []string
	events, _ := h.srv.audit.Store().Query(audit.Query{Actions: []string{string(audit.ADBConnect)}})
	for _, e := range slices.Backward(events) {
		got = append(got, string(e.Result)+"|"+e.Actor)
	}
	want := []string{"ok|beaver", "denied|beaver", "ok|otter", "ok|root", "denied|otter"}
	if !slices.Equal(got, want) {
		t.Fatalf("adb.connect events %v, want %v", got, want)
	}
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
