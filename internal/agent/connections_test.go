package agent

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func TestNetworkConnections(t *testing.T) {
	clash := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/connections" {
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, `{"downloadTotal":1,"uploadTotal":1,"connections":[
			{"id":"a","metadata":{"network":"tcp","type":"tun/tun","destinationIP":"81.2.69.160","destinationPort":"443","host":"api.example.com"},
			 "upload":10,"download":20,"start":"2026-10-27T10:00:00Z","chains":["pl","select"],"rule":"final"},
			{"id":"b","metadata":{"network":"udp","type":"tun/tun","destinationIP":"::ffff:104.16.1.1","destinationPort":"443","host":""},
			 "upload":1,"download":2,"start":"2026-10-27T10:00:01Z","chains":["bypass"],"rule":"ip_cidr"},
			{"id":"probe","metadata":{"network":"tcp","type":"mixed/agent","destinationIP":"1.1.1.1","destinationPort":"443"},
			 "start":"2026-10-27T10:00:02Z","chains":["pl","select"]},
			{"id":"dns","metadata":{"network":"udp","type":"tun/tun","destinationIP":"127.0.0.1","destinationPort":"10053"},
			 "start":"2026-10-27T10:00:02Z","chains":["dns-forwarder"]},
			{"id":"up","metadata":{"network":"udp","type":"direct/dns-upstream","destinationIP":"10.43.0.10","destinationPort":"53"},
			 "start":"2026-10-27T10:00:02Z","chains":["pl","select"]}
		]}`)
	}))
	defer clash.Close()

	got, err := NewNetwork(clash.URL, "", "").Connections(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 10, 27, 10, 0, 0, 0, time.UTC)
	want := []contract.Connection{
		{ID: "a", Start: start, Network: "tcp", Host: "api.example.com", Address: "81.2.69.160", Port: 443, Outbound: "pl", Upload: 10, Download: 20},
		{ID: "b", Start: start.Add(time.Second), Network: "udp", Address: "104.16.1.1", Port: 443, Outbound: "bypass", Upload: 1, Download: 2},
	}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if !got[i].Start.Equal(want[i].Start) {
			t.Errorf("%d: start %v", i, got[i].Start)
		}
		got[i].Start = want[i].Start
		if got[i] != want[i] {
			t.Errorf("%d: got %+v, want %+v", i, got[i], want[i])
		}
	}
}
