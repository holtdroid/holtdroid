package conns

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"google.golang.org/protobuf/encoding/protowire"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func newTest(t *testing.T) (*Tracker, *time.Time, func() (contract.Connection, bool)) {
	t.Helper()
	tr := New(slog.New(slog.DiscardHandler))
	now := time.Date(2026, 10, 27, 10, 0, 0, 0, time.UTC)
	tr.now = func() time.Time { return now }
	ch, stop := tr.Subscribe()
	t.Cleanup(stop)
	return tr, &now, func() (contract.Connection, bool) {
		select {
		case c := <-ch:
			return c, true
		default:
			return contract.Connection{}, false
		}
	}
}

func TestSync(t *testing.T) {
	tr, now, next := newTest(t)
	a := contract.Connection{ID: "a", Start: *now, Host: "api.example.com", Upload: 1}
	b := contract.Connection{ID: "b", Start: *now, Host: "cdn.example.com"}
	tr.Sync([]contract.Connection{a, b})
	for _, id := range []string{"a", "b"} {
		if c, ok := next(); !ok || c.ID != id {
			t.Fatalf("opened %+v %v, want %s", c, ok, id)
		}
	}

	*now = now.Add(5 * time.Second)
	a.Upload = 2
	tr.Sync([]contract.Connection{a, b})
	if c, ok := next(); ok {
		t.Fatalf("an update within 10 s: %+v", c)
	}
	*now = now.Add(5 * time.Second)
	a.Upload = 3
	tr.Sync([]contract.Connection{a, b})
	if c, ok := next(); !ok || c.ID != "a" || c.Upload != 3 || !c.End.IsZero() {
		t.Fatalf("update %+v %v", c, ok)
	}

	*now = now.Add(time.Second)
	tr.Sync([]contract.Connection{b})
	if c, ok := next(); !ok || c.ID != "a" || !c.End.Equal(*now) || c.Upload != 3 {
		t.Fatalf("closed %+v %v", c, ok)
	}

	var replay []contract.Connection
	ctx, cancel := context.WithCancel(context.Background())
	_ = tr.Watch(ctx, func(c contract.Connection) error {
		replay = append(replay, c)
		if len(replay) == 2 {
			cancel()
		}
		return nil
	})
	if len(replay) != 2 || replay[0].ID != "a" || replay[0].End.IsZero() || replay[1].ID != "b" {
		t.Fatalf("replay %+v", replay)
	}
	late, stopLate := tr.Subscribe()
	defer stopLate()
	if c := <-late; c.ID != "b" {
		t.Fatalf("a recording starting now got %+v", c)
	}
}

func str(b []byte, num protowire.Number, s string) []byte {
	b = protowire.AppendTag(b, num, protowire.BytesType)
	return protowire.AppendString(b, s)
}

func num(b []byte, n protowire.Number, v int64) []byte {
	b = protowire.AppendTag(b, n, protowire.VarintType)
	return protowire.AppendVarint(b, uint64(v))
}

func conn(id, inbound, dest, domain string, created, closed, up, down int64, chain ...string) []byte {
	b := str(nil, 1, id)
	b = str(b, 2, inbound)
	b = str(b, 5, "tcp")
	b = str(b, 7, dest)
	b = str(b, 8, domain)
	b = num(b, 12, created)
	if closed != 0 {
		b = num(b, 13, closed)
	}
	b = num(b, 16, up)
	b = num(b, 17, down)
	for _, c := range chain {
		b = str(b, 21, c)
	}
	return b
}

func ev(typ int64, id string, c []byte, up, down, closed int64) []byte {
	b := num(nil, 1, typ)
	b = str(b, 2, id)
	if c != nil {
		b = protowire.AppendTag(b, 3, protowire.BytesType)
		b = protowire.AppendBytes(b, c)
	}
	if up != 0 {
		b = num(b, 4, up)
	}
	if down != 0 {
		b = num(b, 5, down)
	}
	if closed != 0 {
		b = num(b, 6, closed)
	}
	return b
}

func events(evs ...[]byte) []byte {
	var b []byte
	for _, e := range evs {
		b = protowire.AppendTag(b, 1, protowire.BytesType)
		b = protowire.AppendBytes(b, e)
	}
	return b
}

func TestSingBoxEvents(t *testing.T) {
	tr, now, next := newTest(t)
	t0 := now.UnixMilli()
	own := func(inbound string, chain []string) bool { return inbound == "agent" }
	feed := func(b []byte) {
		t.Helper()
		evs, err := parseEvents(b)
		if err != nil {
			t.Fatal(err)
		}
		tr.apply(evs, own)
	}

	feed(events(
		ev(eventNew, "old", conn("old", "tun", "81.2.69.160:443", "api.example.com", t0-5000, t0-4000, 10, 20, "pl", "select"), 0, 0, 0),
		ev(eventNew, "a", conn("a", "tun", "[::ffff:104.16.1.1]:443", "cdn.example.com", t0, 0, 0, 0, "pl", "select"), 0, 0, 0),
		ev(eventNew, "probe", conn("probe", "agent", "1.1.1.1:443", "", t0, 0, 0, 0, "pl", "select"), 0, 0, 0),
		ev(eventNew, "lo", conn("lo", "tun", "127.0.0.1:10053", "", t0, 0, 0, 0, "dns-forwarder"), 0, 0, 0),
		ev(eventNew, "named", conn("named", "phone", "neverssl.com:80", "", t0, 0, 0, 0, "pl"), 0, 0, 0),
	))
	old, _ := next()
	if old.ID != "old" || old.End.UnixMilli() != t0-4000 || old.Download != 20 || old.Outbound != "pl" || old.Address != "81.2.69.160" {
		t.Fatalf("closed before the agent saw it: %+v", old)
	}
	if a, _ := next(); a.ID != "a" || a.Address != "104.16.1.1" || a.Port != 443 || !a.End.IsZero() {
		t.Fatalf("open: %+v", a)
	}
	if n, _ := next(); n.ID != "named" || n.Host != "neverssl.com" || n.Address != "" || n.Port != 80 {
		t.Fatalf("a name destination: %+v", n)
	}
	if c, ok := next(); ok {
		t.Fatalf("own or loopback connection got through: %+v", c)
	}

	*now = now.Add(11 * time.Second)
	feed(events(ev(eventUpdate, "a", nil, 100, 2000, 0), ev(eventUpdate, "probe", nil, 5, 5, 0)))
	if a, ok := next(); !ok || a.Upload != 100 || a.Download != 2000 {
		t.Fatalf("traffic: %+v %v", a, ok)
	}
	if c, ok := next(); ok {
		t.Fatalf("an unknown connection's traffic: %+v", c)
	}

	short := conn("short", "tun", "52.94.0.1:443", "s3.example.com", t0+11000, t0+11054, 1808, 6401, "pl", "select")
	feed(events(
		ev(eventClosed, "short", short, 0, 0, t0+11054),
		ev(eventClosed, "a", conn("a", "tun", "104.16.1.1:443", "cdn.example.com", t0, t0+12000, 150, 3000, "pl", "select"), 0, 0, t0+12000),
		ev(eventClosed, "probe", nil, 0, 0, t0+12000),
	))
	if s, _ := next(); s.ID != "short" || s.End.Sub(s.Start) != 54*time.Millisecond || s.Download != 6401 {
		t.Fatalf("a connection shorter than a poll: %+v", s)
	}
	if a, _ := next(); a.ID != "a" || a.Download != 3000 || a.End.UnixMilli() != t0+12000 {
		t.Fatalf("closed with its last bytes: %+v", a)
	}
	if c, ok := next(); ok {
		t.Fatalf("own close got through: %+v", c)
	}

	feed(events(ev(eventNew, "old", conn("old", "tun", "81.2.69.160:443", "api.example.com", t0-5000, t0-4000, 10, 20, "pl"), 0, 0, 0)))
	if c, ok := next(); ok {
		t.Fatalf("a reconnect repeated %+v", c)
	}
}

func TestSetEdge(t *testing.T) {
	tr, now, next := newTest(t)
	tr.Open(contract.Connection{ID: "a", Start: *now, Host: "api.example.com", Outbound: "lv"})
	tr.Open(contract.Connection{ID: "other", Start: *now, Host: "api.example.com", Outbound: "pl"})
	next()
	next()
	tr.SetEdge("api.example.com", "lv", "VNO")
	if c, ok := next(); !ok || c.ID != "a" || c.Edge != "VNO" {
		t.Fatalf("resent %+v %v", c, ok)
	}
	if c, ok := next(); ok {
		t.Fatalf("another location's connection got the edge: %+v", c)
	}
	tr.Open(contract.Connection{ID: "b", Start: *now, Host: "api.example.com", Outbound: "lv"})
	if c, _ := next(); c.Edge != "VNO" {
		t.Fatalf("a new connection: %+v", c)
	}
	tr.Close("a", now.Add(time.Second), &contract.Connection{ID: "a", Start: *now, Host: "api.example.com", Outbound: "lv", Download: 9})
	if c, _ := next(); c.Edge != "VNO" || c.Download != 9 {
		t.Fatalf("closed with sing-box's final line: %+v", c)
	}
}
