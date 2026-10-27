package fake

import (
	"context"
	"hash/fnv"
	"strings"
	"time"

	"golang.org/x/net/dns/dnsmessage"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/recording"
)

var fakeNames = []string{
	"api.example.com", "cdn.example.com", "fonts.gstatic.com", "www.google-analytics.com",
	"auth.example.com", "img.cdn.example.com", "telemetry.example.net", "old-api.example.invalid",
}

// fakeUpstream answers every name with addresses from 203.0.113.0/24 derived
// from it, and .invalid names with NXDOMAIN.
type fakeUpstream struct{}

func (fakeUpstream) Exchange(_ context.Context, query []byte, _ bool) ([]byte, error) {
	var m dnsmessage.Message
	if err := m.Unpack(query); err != nil {
		return nil, err
	}
	m.Response, m.RecursionAvailable = true, true
	q := m.Questions[0]
	name := strings.TrimSuffix(q.Name.String(), ".")
	h := fnv.New32a()
	_, _ = h.Write([]byte(name))
	sum := h.Sum32()
	switch {
	case strings.HasSuffix(name, ".invalid"):
		m.RCode = dnsmessage.RCodeNameError
	case q.Type == dnsmessage.TypeA:
		for i := range 2 {
			m.Answers = append(m.Answers, dnsmessage.Resource{
				Header: dnsmessage.ResourceHeader{Name: q.Name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET, TTL: 60 + sum%600},
				Body:   &dnsmessage.AResource{A: [4]byte{203, 0, 113, byte(sum>>8) + byte(i)}},
			})
		}
	}
	return m.Pack()
}

func fakeQuery(name string, t dnsmessage.Type, id uint16) []byte {
	b := dnsmessage.NewBuilder(nil, dnsmessage.Header{ID: id, RecursionDesired: true})
	_ = b.StartQuestions()
	_ = b.Question(dnsmessage.Question{Name: dnsmessage.MustNewName(name + "."), Type: t, Class: dnsmessage.ClassINET})
	q, _ := b.Finish()
	return q
}

// simulateDNS has the app look up a name every few seconds while it runs.
func (d *device) simulateDNS() {
	tick := time.NewTicker(3 * time.Second)
	defer tick.Stop()
	for i := 0; ; i++ {
		select {
		case <-d.done:
			return
		case <-tick.C:
		}
		if !d.Status(context.Background()).AppRunning {
			continue
		}
		name := fakeNames[i%len(fakeNames)]
		for _, t := range []dnsmessage.Type{dnsmessage.TypeA, dnsmessage.TypeAAAA} {
			d.resolver.Resolve(context.Background(), fakeQuery(name, t, uint16(i)), false)
		}
		d.fconns.touch(name, d.session().Location, d.clock())
		_ = d.conns.Poll(context.Background())
	}
}

func (d *device) DNS(context.Context) contract.DNSState {
	return contract.DNSState{Available: true, Settings: d.resolver.Settings()}
}

func (d *device) SetDNS(ctx context.Context, settings contract.DNSSettings) (contract.DNSState, error) {
	if _, err := d.resolver.Set(ctx, settings); err != nil {
		return contract.DNSState{}, err
	}
	return d.DNS(ctx), nil
}

func (d *device) FlushDNS(ctx context.Context) error { return d.resolver.Flush(ctx) }

func (d *device) WatchDNS(ctx context.Context, send func(contract.DNSEvent) error) error {
	return d.resolver.Watch(ctx, send)
}

func (d *device) recordDNS(ctx context.Context, rec *recording.Recorder) {
	ch, stop := d.resolver.Subscribe()
	defer stop()
	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-ch:
			rec.Event(contract.RecordingEvent{Type: contract.EventDNS, DNS: &ev})
		}
	}
}
