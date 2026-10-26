package dns

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"golang.org/x/net/dns/dnsmessage"

	"github.com/holtdroid/holtdroid/internal/contract"
)

type upstream struct {
	calls atomic.Int32
	fail  bool
}

func (u *upstream) Exchange(_ context.Context, query []byte, _ bool) ([]byte, error) {
	u.calls.Add(1)
	if u.fail {
		return nil, errors.New("unreachable")
	}
	var m dnsmessage.Message
	if err := m.Unpack(query); err != nil {
		return nil, err
	}
	m.Response = true
	q := m.Questions[0]
	switch {
	case strings.HasPrefix(q.Name.String(), "missing."):
		m.RCode = dnsmessage.RCodeNameError
		m.Authorities = []dnsmessage.Resource{{
			Header: dnsmessage.ResourceHeader{Name: dnsmessage.MustNewName("example.com."), Type: dnsmessage.TypeSOA, Class: dnsmessage.ClassINET, TTL: 900},
			Body: &dnsmessage.SOAResource{
				NS: dnsmessage.MustNewName("ns.example.com."), MBox: dnsmessage.MustNewName("admin.example.com."), MinTTL: 3600,
			},
		}}
	case q.Type == dnsmessage.TypeA:
		m.Answers = []dnsmessage.Resource{{
			Header: dnsmessage.ResourceHeader{Name: q.Name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET, TTL: 300},
			Body:   &dnsmessage.AResource{A: [4]byte{93, 184, 215, 14}},
		}}
	}
	return m.Pack()
}

func query(t *testing.T, name string, typ dnsmessage.Type) []byte {
	t.Helper()
	b := dnsmessage.NewBuilder(nil, dnsmessage.Header{ID: 0x1234, RecursionDesired: true})
	_ = b.StartQuestions()
	if err := b.Question(dnsmessage.Question{Name: dnsmessage.MustNewName(name + "."), Type: typ, Class: dnsmessage.ClassINET}); err != nil {
		t.Fatal(err)
	}
	q, err := b.Finish()
	if err != nil {
		t.Fatal(err)
	}
	return q
}

func lastQuery(t *testing.T, s *Server) contract.DNSQuery {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.events) == 0 {
		t.Fatal("nothing logged")
	}
	return *s.events[len(s.events)-1].Query
}

func TestResolve(t *testing.T) {
	rewrites := []contract.DNSRewrite{
		{Pattern: "*.example.com", Kind: contract.DNSRewriteAddress, Addresses: []string{"10.0.0.1"}, TTL: 30, Enabled: true},
		{Pattern: "*.api.example.com", Kind: contract.DNSRewriteAddress, Addresses: []string{"10.0.0.2", "10.0.0.3"}, Enabled: true},
		{Pattern: "exact.api.example.com", Kind: contract.DNSRewriteNXDomain, Enabled: true},
		{Pattern: "Alias.Example.org.", Kind: contract.DNSRewriteCNAME, Target: "target.example.net", TTL: 5, Enabled: true},
		{Pattern: "off.example.org", Kind: contract.DNSRewriteNXDomain},
	}
	tests := []struct {
		name     string
		host     string
		typ      dnsmessage.Type
		settings contract.DNSSettings
		fail     bool
		result   contract.DNSResult
		rcode    string
		rule     string
		answers  []string
		ttls     []uint32
	}{
		{name: "forwarded", host: "example.net", typ: dnsmessage.TypeA, result: contract.DNSAnswered, rcode: "NOERROR", answers: []string{"A 93.184.215.14"}, ttls: []uint32{300}},
		{
			name: "ttl limited", host: "example.net", typ: dnsmessage.TypeA, settings: contract.DNSSettings{TTLMode: contract.DNSTTLLimit, MaxTTL: 0},
			result: contract.DNSAnswered, rcode: "NOERROR", answers: []string{"A 93.184.215.14"}, ttls: []uint32{0},
		},
		{name: "aaaa", host: "example.net", typ: dnsmessage.TypeAAAA, result: contract.DNSIPv4Only, rcode: "NOERROR"},
		{name: "upstream down", host: "example.net", typ: dnsmessage.TypeA, fail: true, result: contract.DNSFailed, rcode: "SERVFAIL"},
		{name: "nxdomain forwarded", host: "missing.example.net", typ: dnsmessage.TypeA, result: contract.DNSAnswered, rcode: "NXDOMAIN"},
		{
			name: "wildcard", host: "www.example.com", typ: dnsmessage.TypeA, settings: contract.DNSSettings{Rewrites: rewrites},
			result: contract.DNSRewritten, rcode: "NOERROR", rule: "*.example.com", answers: []string{"A 10.0.0.1"}, ttls: []uint32{30},
		},
		{
			name: "apex is not a wildcard match", host: "example.com", typ: dnsmessage.TypeA, settings: contract.DNSSettings{Rewrites: rewrites},
			result: contract.DNSAnswered, rcode: "NOERROR", answers: []string{"A 93.184.215.14"}, ttls: []uint32{300},
		},
		{
			name: "longer wildcard wins", host: "v1.api.example.com", typ: dnsmessage.TypeA, settings: contract.DNSSettings{Rewrites: rewrites},
			result: contract.DNSRewritten, rcode: "NOERROR", rule: "*.api.example.com", answers: []string{"A 10.0.0.2", "A 10.0.0.3"}, ttls: []uint32{0, 0},
		},
		{
			name: "exact wins", host: "exact.api.example.com", typ: dnsmessage.TypeA, settings: contract.DNSSettings{Rewrites: rewrites},
			result: contract.DNSRewritten, rcode: "NXDOMAIN", rule: "exact.api.example.com",
		},
		{
			name: "rewritten name has no aaaa", host: "www.example.com", typ: dnsmessage.TypeAAAA, settings: contract.DNSSettings{Rewrites: rewrites},
			result: contract.DNSRewritten, rcode: "NOERROR", rule: "*.example.com",
		},
		{
			name: "cname", host: "alias.example.org", typ: dnsmessage.TypeA, settings: contract.DNSSettings{Rewrites: rewrites, TTLMode: contract.DNSTTLLimit, MaxTTL: 60},
			result: contract.DNSRewritten, rcode: "NOERROR", rule: "alias.example.org",
			answers: []string{"CNAME target.example.net", "A 93.184.215.14"}, ttls: []uint32{5, 60},
		},
		{
			name: "disabled rule", host: "off.example.org", typ: dnsmessage.TypeA, settings: contract.DNSSettings{Rewrites: rewrites},
			result: contract.DNSAnswered, rcode: "NOERROR", answers: []string{"A 93.184.215.14"}, ttls: []uint32{300},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := New(&upstream{fail: tt.fail}, nil, slog.New(slog.DiscardHandler))
			if _, err := s.Set(t.Context(), tt.settings); err != nil {
				t.Fatal(err)
			}
			resp := s.Resolve(t.Context(), query(t, tt.host, tt.typ), false)
			var m dnsmessage.Message
			if err := m.Unpack(resp); err != nil {
				t.Fatal(err)
			}
			if m.ID != 0x1234 || !m.Response || len(m.Questions) != 1 {
				t.Fatalf("header %+v, questions %v", m.Header, m.Questions)
			}
			var answers []string
			var ttls []uint32
			for _, a := range m.Answers {
				answers = append(answers, typeName(a.Header.Type)+" "+data(a.Body))
				ttls = append(ttls, a.Header.TTL)
			}
			if !slices.Equal(answers, tt.answers) || !slices.Equal(ttls, tt.ttls) {
				t.Errorf("answers %v %v, want %v %v", answers, ttls, tt.answers, tt.ttls)
			}
			e := lastQuery(t, s)
			if e.Result != tt.result || e.Rcode != tt.rcode || e.Rule != tt.rule || e.Name != tt.host {
				t.Errorf("logged %+v", e)
			}
			if len(e.Answers) != len(tt.answers) {
				t.Errorf("logged answers %+v", e.Answers)
			}
		})
	}
}

func TestLimitTTLNegative(t *testing.T) {
	s := New(&upstream{}, nil, slog.New(slog.DiscardHandler))
	if _, err := s.Set(t.Context(), contract.DNSSettings{TTLMode: contract.DNSTTLLimit, MaxTTL: 10}); err != nil {
		t.Fatal(err)
	}
	var m dnsmessage.Message
	if err := m.Unpack(s.Resolve(t.Context(), query(t, "missing.example.com", dnsmessage.TypeA), false)); err != nil {
		t.Fatal(err)
	}
	soa := m.Authorities[0]
	if soa.Header.TTL != 10 || soa.Body.(*dnsmessage.SOAResource).MinTTL != 10 {
		t.Errorf("soa %+v %+v", soa.Header, soa.Body)
	}
}

func TestSet(t *testing.T) {
	tests := []struct {
		name string
		in   contract.DNSRewrite
		err  bool
	}{
		{"address", contract.DNSRewrite{Pattern: "a.example.com", Kind: contract.DNSRewriteAddress, Addresses: []string{" 127.0.0.1"}}, false},
		{"ipv6", contract.DNSRewrite{Pattern: "a.example.com", Kind: contract.DNSRewriteAddress, Addresses: []string{"::1"}}, true},
		{"no address", contract.DNSRewrite{Pattern: "a.example.com", Kind: contract.DNSRewriteAddress}, true},
		{"bad pattern", contract.DNSRewrite{Pattern: "a.*.example.com", Kind: contract.DNSRewriteNXDomain}, true},
		{"bare star", contract.DNSRewrite{Pattern: "*", Kind: contract.DNSRewriteNXDomain}, true},
		{"cname", contract.DNSRewrite{Pattern: "*.example.com", Kind: contract.DNSRewriteCNAME, Target: "b.example.net."}, false},
		{"cname without target", contract.DNSRewrite{Pattern: "*.example.com", Kind: contract.DNSRewriteCNAME}, true},
		{"unknown kind", contract.DNSRewrite{Pattern: "a.example.com", Kind: "drop"}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := New(&upstream{}, nil, slog.New(slog.DiscardHandler))
			_, err := s.Set(t.Context(), contract.DNSSettings{Rewrites: []contract.DNSRewrite{tt.in}})
			if (err != nil) != tt.err {
				t.Fatalf("err %v", err)
			}
			if err != nil && !errors.Is(err, contract.ErrInvalid) {
				t.Errorf("err %v is not ErrInvalid", err)
			}
		})
	}

	s := New(&upstream{}, nil, slog.New(slog.DiscardHandler))
	dup := contract.DNSRewrite{Pattern: "a.example.com", Kind: contract.DNSRewriteNXDomain}
	if _, err := s.Set(t.Context(), contract.DNSSettings{Rewrites: []contract.DNSRewrite{dup, dup}}); err == nil {
		t.Error("duplicate pattern accepted")
	}
}

func TestFlushOnRewriteChange(t *testing.T) {
	var flushes int
	s := New(&upstream{}, func(context.Context) error { flushes++; return nil }, slog.New(slog.DiscardHandler))
	r := contract.DNSRewrite{Pattern: "a.example.com", Kind: contract.DNSRewriteNXDomain, Enabled: true}
	steps := []struct {
		settings contract.DNSSettings
		flushes  int
	}{
		{contract.DNSSettings{TTLMode: contract.DNSTTLLimit, MaxTTL: 5}, 0},
		{contract.DNSSettings{Rewrites: []contract.DNSRewrite{r}}, 1},
		{contract.DNSSettings{Rewrites: []contract.DNSRewrite{r}, TTLMode: contract.DNSTTLLimit}, 1},
		{contract.DNSSettings{}, 2},
	}
	for i, st := range steps {
		if _, err := s.Set(t.Context(), st.settings); err != nil {
			t.Fatal(err)
		}
		if flushes != st.flushes {
			t.Fatalf("step %d: %d flushes, want %d", i, flushes, st.flushes)
		}
	}
}

func TestWatch(t *testing.T) {
	s := New(&upstream{}, nil, slog.New(slog.DiscardHandler))
	s.Resolve(t.Context(), query(t, "one.example.com", dnsmessage.TypeA), false)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	got := make(chan contract.DNSEvent, 10)
	go func() {
		_ = s.Watch(ctx, func(e contract.DNSEvent) error { got <- e; return nil })
	}()
	if e := <-got; e.Settings == nil {
		t.Fatalf("first event %+v", e)
	}
	if e := <-got; e.Query == nil || e.Query.Name != "one.example.com" {
		t.Fatalf("backlog %+v", e)
	}
	if err := s.Flush(t.Context()); err != nil {
		t.Fatal(err)
	}
	if e := <-got; !e.Flushed {
		t.Fatalf("live %+v", e)
	}
}

func TestNetUpstream(t *testing.T) {
	fake := New(&upstream{}, nil, slog.New(slog.DiscardHandler))
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	addr := pc.LocalAddr().String()
	l, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	go fake.serveTCP(t.Context(), l)
	go func() {
		buf := make([]byte, 512)
		for {
			n, from, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			_, _ = pc.WriteTo(fake.Resolve(t.Context(), buf[:n], false), from)
		}
	}()

	s := New(NetUpstream{Addr: addr}, nil, slog.New(slog.DiscardHandler))
	for _, tcp := range []bool{false, true} {
		var m dnsmessage.Message
		if err := m.Unpack(s.Resolve(t.Context(), query(t, "example.net", dnsmessage.TypeA), tcp)); err != nil {
			t.Fatal(err)
		}
		if len(m.Answers) != 1 {
			t.Errorf("tcp=%v: answers %v", tcp, m.Answers)
		}
	}
	if e := lastQuery(t, s); e.Protocol != "tcp" {
		t.Errorf("protocol %q", e.Protocol)
	}
}

func TestSVCBPresentation(t *testing.T) {
	r := dnsmessage.SVCBResource{
		Priority: 1,
		Target:   dnsmessage.MustNewName("."),
		Params: []dnsmessage.SVCParam{
			{Key: dnsmessage.SVCParamMandatory, Value: []byte{0, 1}},
			{Key: dnsmessage.SVCParamALPN, Value: []byte("\x02h3\x02h2")},
			{Key: dnsmessage.SVCParamPort, Value: []byte{0x01, 0xbb}},
			{Key: dnsmessage.SVCParamIPv4Hint, Value: []byte{142, 250, 1, 1, 142, 250, 1, 2}},
			{Key: dnsmessage.SVCParamECH, Value: []byte{1, 2, 3}},
			{Key: dnsmessage.SVCParamKey(99), Value: []byte{1}},
		},
	}
	want := "1 . mandatory=alpn alpn=h3,h2 port=443 ipv4hint=142.250.1.1,142.250.1.2 ech key99"
	if got := svcb(r); got != want {
		t.Errorf("got  %q\nwant %q", got, want)
	}
	alias := dnsmessage.SVCBResource{Priority: 0, Target: dnsmessage.MustNewName("svc.example.com.")}
	if got := svcb(alias); got != "0 svc.example.com" {
		t.Errorf("alias %q", got)
	}
}
