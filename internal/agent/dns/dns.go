// Package dns is the session's DNS forwarder: the VPN sidecar hands it every
// query of the device, and it answers rewrites itself, limits TTLs, keeps a
// log and forwards the rest to the upstream through the sidecar.
package dns

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/dns/dnsmessage"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const (
	backlog     = 2000
	maxRewrites = 500
	timeout     = 5 * time.Second
)

// Upstream answers a raw query: over TCP when tcp is set, else UDP.
type Upstream interface {
	Exchange(ctx context.Context, query []byte, tcp bool) ([]byte, error)
}

// NetUpstream sends queries to Addr.
type NetUpstream struct{ Addr string }

func (u NetUpstream) Exchange(ctx context.Context, query []byte, tcp bool) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	network := "udp"
	if tcp {
		network = "tcp"
	}
	var d net.Dialer
	c, err := d.DialContext(ctx, network, u.Addr)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	if dl, ok := ctx.Deadline(); ok {
		_ = c.SetDeadline(dl)
	}
	if tcp {
		if err := writeTCP(c, query); err != nil {
			return nil, err
		}
		return readTCP(c)
	}
	if _, err := c.Write(query); err != nil {
		return nil, err
	}
	buf := make([]byte, 65535)
	for {
		n, err := c.Read(buf)
		if err != nil {
			return nil, err
		}
		if n >= 12 && query[0] == buf[0] && query[1] == buf[1] {
			return slices.Clone(buf[:n]), nil
		}
	}
}

func writeTCP(w io.Writer, msg []byte) error {
	_, err := w.Write(append(binary.BigEndian.AppendUint16(nil, uint16(len(msg))), msg...))
	return err
}

func readTCP(r io.Reader) ([]byte, error) {
	var n [2]byte
	if _, err := io.ReadFull(r, n[:]); err != nil {
		return nil, err
	}
	msg := make([]byte, binary.BigEndian.Uint16(n[:]))
	_, err := io.ReadFull(r, msg)
	return msg, err
}

// Server is safe for concurrent use.
type Server struct {
	up    Upstream
	flush func(context.Context) error
	log   *slog.Logger
	now   func() time.Time

	mu       sync.Mutex
	settings contract.DNSSettings
	rules    []rule
	events   []contract.DNSEvent
	nextID   int64
	subs     map[chan contract.DNSEvent]struct{}
}

// New answers through up; flush clears the device's own cache.
func New(up Upstream, flush func(context.Context) error, log *slog.Logger) *Server {
	return &Server{
		up:       up,
		flush:    flush,
		log:      log,
		now:      time.Now,
		settings: contract.DNSSettings{TTLMode: contract.DNSTTLKeep, Rewrites: []contract.DNSRewrite{}},
		subs:     map[chan contract.DNSEvent]struct{}{},
	}
}

func (s *Server) Settings() contract.DNSSettings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneSettings(s.settings)
}

// Set replaces the settings. A change of the rewrites clears the device's
// cache, so it takes effect at once.
func (s *Server) Set(ctx context.Context, in contract.DNSSettings) (contract.DNSSettings, error) {
	in, rules, err := compile(in)
	if err != nil {
		return contract.DNSSettings{}, err
	}
	s.mu.Lock()
	changed := !slices.EqualFunc(s.settings.Rewrites, in.Rewrites, equalRewrite) || s.settings.AllowEncrypted != in.AllowEncrypted
	s.settings, s.rules = in, rules
	s.publish(contract.DNSEvent{At: s.now(), Settings: new(cloneSettings(in))})
	s.mu.Unlock()
	if changed {
		if err := s.Flush(ctx); err != nil {
			s.log.Warn("dns: clear the device's cache", "err", err)
		}
	}
	return cloneSettings(in), nil
}

func (s *Server) Flush(ctx context.Context) error {
	if s.flush != nil {
		if err := s.flush(ctx); err != nil {
			return err
		}
	}
	s.mu.Lock()
	s.publish(contract.DNSEvent{At: s.now(), Flushed: true})
	s.mu.Unlock()
	return nil
}

// Watch sends the settings, the queries still kept, and then every event.
func (s *Server) Watch(ctx context.Context, send func(contract.DNSEvent) error) error {
	s.mu.Lock()
	first := append([]contract.DNSEvent{{At: s.now(), Settings: new(cloneSettings(s.settings))}}, s.events...)
	ch, cancel := s.subscribeLocked()
	s.mu.Unlock()
	defer cancel()
	for _, ev := range first {
		if err := send(ev); err != nil {
			return err
		}
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case ev := <-ch:
			if err := send(ev); err != nil {
				return err
			}
		}
	}
}

// Subscribe follows new events, for a recording; the current settings come
// first.
func (s *Server) Subscribe() (<-chan contract.DNSEvent, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch, cancel := s.subscribeLocked()
	ch <- contract.DNSEvent{At: s.now(), Settings: new(cloneSettings(s.settings))}
	return ch, cancel
}

func (s *Server) subscribeLocked() (chan contract.DNSEvent, func()) {
	ch := make(chan contract.DNSEvent, 512)
	s.subs[ch] = struct{}{}
	return ch, func() {
		s.mu.Lock()
		delete(s.subs, ch)
		s.mu.Unlock()
	}
}

func (s *Server) publish(ev contract.DNSEvent) {
	if ev.Query != nil {
		s.events = append(s.events, ev)
		if len(s.events) > backlog {
			s.events = slices.Delete(s.events, 0, len(s.events)-backlog)
		}
	}
	for ch := range s.subs {
		select {
		case ch <- ev:
		default:
		}
	}
}

// ListenAndServe answers on addr over UDP and TCP until ctx ends.
func (s *Server) ListenAndServe(ctx context.Context, addr string) error {
	var lc net.ListenConfig
	pc, err := lc.ListenPacket(ctx, "udp", addr)
	if err != nil {
		return err
	}
	l, err := lc.Listen(ctx, "tcp", addr)
	if err != nil {
		pc.Close()
		return err
	}
	go func() {
		<-ctx.Done()
		pc.Close()
		l.Close()
	}()
	go s.serveTCP(ctx, l)
	buf := make([]byte, 65535)
	for {
		n, from, err := pc.ReadFrom(buf)
		if err != nil {
			return ignoreClosed(ctx, err)
		}
		q := slices.Clone(buf[:n])
		go func() {
			if resp := s.Resolve(ctx, q, false); resp != nil {
				_, _ = pc.WriteTo(resp, from)
			}
		}()
	}
}

func ignoreClosed(ctx context.Context, err error) error {
	if ctx.Err() != nil && errors.Is(err, net.ErrClosed) {
		return nil
	}
	return err
}

func (s *Server) serveTCP(ctx context.Context, l net.Listener) {
	for {
		c, err := l.Accept()
		if err != nil {
			return
		}
		go func() {
			defer c.Close()
			for {
				_ = c.SetReadDeadline(time.Now().Add(30 * time.Second))
				q, err := readTCP(c)
				if err != nil {
					return
				}
				resp := s.Resolve(ctx, q, true)
				if resp == nil || writeTCP(c, resp) != nil {
					return
				}
			}
		}()
	}
}

// Resolve answers one raw query, or returns nil for one that can't be read.
func (s *Server) Resolve(ctx context.Context, query []byte, tcp bool) []byte {
	start := s.now()
	var p dnsmessage.Parser
	h, err := p.Start(query)
	if err != nil || h.Response {
		return nil
	}
	q, err := p.Question()
	if err != nil {
		return nil
	}
	entry := contract.DNSQuery{
		At:       start,
		Name:     displayName(q.Name),
		Type:     typeName(q.Type),
		Protocol: "udp",
		Answers:  []contract.DNSAnswer{},
	}
	if tcp {
		entry.Protocol = "tcp"
	}

	s.mu.Lock()
	r, matched := match(s.rules, entry.Name)
	_, blocked := match(encrypted, entry.Name)
	blocked = blocked && !s.settings.AllowEncrypted
	limit, limited := s.settings.MaxTTL, s.settings.TTLMode == contract.DNSTTLLimit
	s.mu.Unlock()

	var resp []byte
	switch {
	case matched:
		entry.Result, entry.Rule = contract.DNSRewritten, r.Pattern
		resp, err = s.rewrite(ctx, h, q, r, limit, limited, tcp, &entry)
	case blocked:
		entry.Result, entry.Rule = contract.DNSBlocked, encryptedRule
		resp, err = reply(h, q, dnsmessage.RCodeNameError, nil)
	case q.Type == dnsmessage.TypeAAAA:
		entry.Result = contract.DNSIPv4Only
		resp, err = reply(h, q, dnsmessage.RCodeSuccess, nil)
	default:
		entry.Result = contract.DNSAnswered
		resp, err = s.forward(ctx, query, limit, limited, tcp, &entry)
	}
	if err != nil {
		entry.Result, entry.Error = contract.DNSFailed, err.Error()
		resp, _ = reply(h, q, dnsmessage.RCodeServerFailure, nil)
	}
	entry.Rcode = rcodeOf(resp)
	entry.Duration = float64(s.now().Sub(start).Microseconds()) / 1000

	s.mu.Lock()
	s.nextID++
	entry.ID = s.nextID
	s.publish(contract.DNSEvent{At: start, Query: &entry})
	s.mu.Unlock()
	return resp
}

func (s *Server) forward(ctx context.Context, query []byte, limit uint32, limited, tcp bool, entry *contract.DNSQuery) ([]byte, error) {
	resp, err := s.up.Exchange(ctx, query, tcp)
	if err != nil {
		return nil, err
	}
	entry.Answers = answers(resp, limit, limited)
	if limited {
		if err := limitTTL(resp, limit); err != nil {
			return nil, fmt.Errorf("upstream answer: %w", err)
		}
	}
	return resp, nil
}

func (s *Server) rewrite(ctx context.Context, h dnsmessage.Header, q dnsmessage.Question, r rule, limit uint32, limited, tcp bool, entry *contract.DNSQuery) ([]byte, error) {
	ttl := r.TTL
	if limited {
		ttl = min(ttl, limit)
	}
	hdr := dnsmessage.ResourceHeader{Name: q.Name, Class: dnsmessage.ClassINET, TTL: ttl}
	add := func(name, typ, data string) {
		entry.Answers = append(entry.Answers, contract.DNSAnswer{Name: name, Type: typ, Data: data, TTL: ttl, OriginalTTL: r.TTL})
	}
	switch r.Kind {
	case contract.DNSRewriteNXDomain:
		return reply(h, q, dnsmessage.RCodeNameError, nil)
	case contract.DNSRewriteAddress:
		if q.Type != dnsmessage.TypeA {
			return reply(h, q, dnsmessage.RCodeSuccess, nil)
		}
		return reply(h, q, dnsmessage.RCodeSuccess, func(b *dnsmessage.Builder) error {
			for _, a := range r.addrs {
				hdr.Type = dnsmessage.TypeA
				if err := b.AResource(hdr, dnsmessage.AResource{A: a.As4()}); err != nil {
					return err
				}
				add(entry.Name, "A", a.String())
			}
			return nil
		})
	}

	target, err := dnsmessage.NewName(r.Target + ".")
	if err != nil {
		return nil, err
	}
	var upstream []dnsmessage.Resource
	if q.Type == dnsmessage.TypeA {
		upstream, err = s.lookupA(ctx, target, tcp)
		if err != nil {
			s.log.Debug("dns: resolve a rewrite's target", "target", r.Target, "err", err)
		}
	}
	return reply(h, q, dnsmessage.RCodeSuccess, func(b *dnsmessage.Builder) error {
		hdr.Type = dnsmessage.TypeCNAME
		if err := b.CNAMEResource(hdr, dnsmessage.CNAMEResource{CNAME: target}); err != nil {
			return err
		}
		add(entry.Name, "CNAME", r.Target)
		for _, res := range upstream {
			a, ok := res.Body.(*dnsmessage.AResource)
			if !ok {
				continue
			}
			orig := res.Header.TTL
			if limited {
				res.Header.TTL = min(orig, limit)
			}
			if err := b.AResource(res.Header, *a); err != nil {
				return err
			}
			entry.Answers = append(entry.Answers, contract.DNSAnswer{
				Name: displayName(res.Header.Name), Type: "A", Data: netip.AddrFrom4(a.A).String(), TTL: res.Header.TTL, OriginalTTL: orig,
			})
		}
		return nil
	})
}

func (s *Server) lookupA(ctx context.Context, name dnsmessage.Name, tcp bool) ([]dnsmessage.Resource, error) {
	b := dnsmessage.NewBuilder(nil, dnsmessage.Header{ID: uint16(time.Now().UnixNano()), RecursionDesired: true})
	_ = b.StartQuestions()
	_ = b.Question(dnsmessage.Question{Name: name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET})
	query, err := b.Finish()
	if err != nil {
		return nil, err
	}
	resp, err := s.up.Exchange(ctx, query, tcp)
	if err != nil {
		return nil, err
	}
	var m dnsmessage.Message
	if err := m.Unpack(resp); err != nil {
		return nil, err
	}
	return m.Answers, nil
}

func reply(h dnsmessage.Header, q dnsmessage.Question, rcode dnsmessage.RCode, answers func(*dnsmessage.Builder) error) ([]byte, error) {
	b := dnsmessage.NewBuilder(nil, dnsmessage.Header{
		ID: h.ID, Response: true, OpCode: h.OpCode, RecursionDesired: h.RecursionDesired, RecursionAvailable: true, RCode: rcode,
	})
	b.EnableCompression()
	if err := b.StartQuestions(); err != nil {
		return nil, err
	}
	if err := b.Question(q); err != nil {
		return nil, err
	}
	if answers != nil {
		if err := b.StartAnswers(); err != nil {
			return nil, err
		}
		if err := answers(&b); err != nil {
			return nil, err
		}
	}
	return b.Finish()
}

func answers(resp []byte, limit uint32, limited bool) []contract.DNSAnswer {
	out := []contract.DNSAnswer{}
	var p dnsmessage.Parser
	if _, err := p.Start(resp); err != nil {
		return out
	}
	if err := p.SkipAllQuestions(); err != nil {
		return out
	}
	for {
		res, err := p.Answer()
		if err != nil {
			return out
		}
		ttl := res.Header.TTL
		if limited {
			ttl = min(ttl, limit)
		}
		out = append(out, contract.DNSAnswer{
			Name: displayName(res.Header.Name), Type: typeName(res.Header.Type), Data: data(res.Body), TTL: ttl, OriginalTTL: res.Header.TTL,
		})
	}
}

func data(b dnsmessage.ResourceBody) string {
	switch r := b.(type) {
	case *dnsmessage.AResource:
		return netip.AddrFrom4(r.A).String()
	case *dnsmessage.AAAAResource:
		return netip.AddrFrom16(r.AAAA).String()
	case *dnsmessage.CNAMEResource:
		return displayName(r.CNAME)
	case *dnsmessage.NSResource:
		return displayName(r.NS)
	case *dnsmessage.PTRResource:
		return displayName(r.PTR)
	case *dnsmessage.MXResource:
		return strconv.Itoa(int(r.Pref)) + " " + displayName(r.MX)
	case *dnsmessage.SRVResource:
		return fmt.Sprintf("%d %d %d %s", r.Priority, r.Weight, r.Port, displayName(r.Target))
	case *dnsmessage.TXTResource:
		return strings.Join(r.TXT, " ")
	case *dnsmessage.SOAResource:
		return displayName(r.NS) + " " + displayName(r.MBox)
	case *dnsmessage.HTTPSResource:
		return svcb(r.SVCBResource)
	case *dnsmessage.SVCBResource:
		return svcb(*r)
	case *dnsmessage.UnknownResource:
		return strconv.Itoa(len(r.Data)) + " bytes"
	}
	return ""
}

func svcb(r dnsmessage.SVCBResource) string {
	target := displayName(r.Target)
	if target == "" {
		target = "."
	}
	parts := []string{strconv.Itoa(int(r.Priority)), target}
	for _, p := range r.Params {
		parts = append(parts, svcParam(p))
	}
	return strings.Join(parts, " ")
}

// svcParam is a parameter in the presentation format of RFC 9460.
func svcParam(p dnsmessage.SVCParam) string {
	v := p.Value
	var vals []string
	switch p.Key {
	case dnsmessage.SVCParamALPN:
		for len(v) > 0 && int(v[0]) < len(v) {
			vals, v = append(vals, string(v[1:1+v[0]])), v[1+v[0]:]
		}
		return "alpn=" + strings.Join(vals, ",")
	case dnsmessage.SVCParamPort:
		if len(v) == 2 {
			return "port=" + strconv.Itoa(int(binary.BigEndian.Uint16(v)))
		}
	case dnsmessage.SVCParamIPv4Hint, dnsmessage.SVCParamIPv6Hint:
		size, key := 4, "ipv4hint="
		if p.Key == dnsmessage.SVCParamIPv6Hint {
			size, key = 16, "ipv6hint="
		}
		for ; len(v) >= size; v = v[size:] {
			a, _ := netip.AddrFromSlice(v[:size])
			vals = append(vals, a.String())
		}
		return key + strings.Join(vals, ",")
	case dnsmessage.SVCParamNoDefaultALPN:
		return "no-default-alpn"
	case dnsmessage.SVCParamECH:
		return "ech"
	case dnsmessage.SVCParamMandatory:
		for ; len(v) >= 2; v = v[2:] {
			vals = append(vals, svcKey(dnsmessage.SVCParamKey(binary.BigEndian.Uint16(v))))
		}
		return "mandatory=" + strings.Join(vals, ",")
	}
	return svcKey(p.Key)
}

func svcKey(k dnsmessage.SVCParamKey) string {
	switch k {
	case dnsmessage.SVCParamDOHPath:
		return "dohpath"
	case dnsmessage.SVCParamOHTTP:
		return "ohttp"
	case dnsmessage.SVCParamALPN, dnsmessage.SVCParamPort, dnsmessage.SVCParamIPv4Hint, dnsmessage.SVCParamIPv6Hint, dnsmessage.SVCParamECH:
		return strings.ToLower(k.String())
	}
	return "key" + strconv.Itoa(int(k))
}

// limitTTL caps the TTLs of an answer in place, the SOA minimum included,
// which Android uses for negative answers.
func limitTTL(msg []byte, limit uint32) error {
	if len(msg) < 12 {
		return errors.New("short message")
	}
	count := func(i int) int { return int(binary.BigEndian.Uint16(msg[4+2*i:])) }
	off := 12
	for range count(0) {
		if off = skipName(msg, off) + 4; off > len(msg) {
			return errors.New("truncated question")
		}
	}
	for range count(1) + count(2) + count(3) {
		off = skipName(msg, off)
		if off < 0 || off+10 > len(msg) {
			return errors.New("truncated record")
		}
		typ := dnsmessage.Type(binary.BigEndian.Uint16(msg[off:]))
		n := int(binary.BigEndian.Uint16(msg[off+8:]))
		end := off + 10 + n
		if end > len(msg) {
			return errors.New("truncated record")
		}
		if typ != dnsmessage.TypeOPT {
			capAt(msg[off+4:], limit)
		}
		if typ == dnsmessage.TypeSOA && n >= 4 {
			capAt(msg[end-4:], limit)
		}
		off = end
	}
	return nil
}

func capAt(b []byte, limit uint32) {
	if binary.BigEndian.Uint32(b) > limit {
		binary.BigEndian.PutUint32(b, limit)
	}
}

func skipName(msg []byte, off int) int {
	for off >= 0 && off < len(msg) {
		l := msg[off]
		switch {
		case l == 0:
			return off + 1
		case l&0xc0 == 0xc0:
			return off + 2
		default:
			off += 1 + int(l)
		}
	}
	return -1
}

func rcodeOf(resp []byte) string {
	if len(resp) < 4 {
		return ""
	}
	switch rc := dnsmessage.RCode(resp[3] & 0x0f); rc {
	case dnsmessage.RCodeSuccess:
		return "NOERROR"
	case dnsmessage.RCodeFormatError:
		return "FORMERR"
	case dnsmessage.RCodeServerFailure:
		return "SERVFAIL"
	case dnsmessage.RCodeNameError:
		return "NXDOMAIN"
	case dnsmessage.RCodeNotImplemented:
		return "NOTIMP"
	case dnsmessage.RCodeRefused:
		return "REFUSED"
	default:
		return "RCODE" + strconv.Itoa(int(rc))
	}
}

func typeName(t dnsmessage.Type) string {
	if s, ok := strings.CutPrefix(t.String(), "Type"); ok {
		return s
	}
	return "TYPE" + strconv.Itoa(int(t))
}

func displayName(n dnsmessage.Name) string {
	return strings.ToLower(strings.TrimSuffix(n.String(), "."))
}

type rule struct {
	contract.DNSRewrite
	addrs []netip.Addr
}

var label = regexp.MustCompile(`^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$`)

func validName(name string) bool {
	if name == "" || len(name) > 253 {
		return false
	}
	for l := range strings.SplitSeq(name, ".") {
		if !label.MatchString(l) {
			return false
		}
	}
	return true
}

func normalize(name string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(name)), ".")
}

// Clean normalizes settings and rejects what the forwarder can't use.
func Clean(in contract.DNSSettings) (contract.DNSSettings, error) {
	out, _, err := compile(in)
	return out, err
}

func compile(in contract.DNSSettings) (contract.DNSSettings, []rule, error) {
	invalid := func(format string, args ...any) (contract.DNSSettings, []rule, error) {
		return contract.DNSSettings{}, nil, fmt.Errorf("%w: "+format, append([]any{contract.ErrInvalid}, args...)...)
	}
	switch in.TTLMode {
	case "":
		in.TTLMode = contract.DNSTTLKeep
	case contract.DNSTTLKeep, contract.DNSTTLLimit:
	default:
		return invalid("unknown TTL mode %q", in.TTLMode)
	}
	if len(in.Rewrites) > maxRewrites {
		return invalid("at most %d rewrites", maxRewrites)
	}
	out := make([]contract.DNSRewrite, 0, len(in.Rewrites))
	var rules []rule
	seen := map[string]bool{}
	for _, r := range in.Rewrites {
		r.Pattern = normalize(r.Pattern)
		if !validName(strings.TrimPrefix(r.Pattern, "*.")) {
			return invalid("%q is not a name or *.name", r.Pattern)
		}
		if seen[r.Pattern] {
			return invalid("%s is rewritten twice", r.Pattern)
		}
		seen[r.Pattern] = true
		ru := rule{}
		switch r.Kind {
		case contract.DNSRewriteAddress:
			r.Target = ""
			if len(r.Addresses) == 0 {
				return invalid("%s: no address", r.Pattern)
			}
			for i, a := range r.Addresses {
				ip, err := netip.ParseAddr(strings.TrimSpace(a))
				if err != nil || !ip.Is4() {
					return invalid("%s: %q is not an IPv4 address", r.Pattern, a)
				}
				r.Addresses[i] = ip.String()
				ru.addrs = append(ru.addrs, ip)
			}
		case contract.DNSRewriteCNAME:
			r.Addresses = nil
			r.Target = normalize(r.Target)
			if !validName(r.Target) {
				return invalid("%s: %q is not a name", r.Pattern, r.Target)
			}
		case contract.DNSRewriteNXDomain:
			r.Addresses, r.Target = nil, ""
		default:
			return invalid("%s: unknown kind %q", r.Pattern, r.Kind)
		}
		out = append(out, r)
		if r.Enabled {
			ru.DNSRewrite = r
			rules = append(rules, ru)
		}
	}
	in.Rewrites = out
	return in, rules, nil
}

func match(rules []rule, name string) (rule, bool) {
	best, found := rule{}, false
	for _, r := range rules {
		if r.Pattern == name {
			return r, true
		}
		suffix, ok := strings.CutPrefix(r.Pattern, "*")
		if ok && strings.HasSuffix(name, suffix) && (!found || len(r.Pattern) > len(best.Pattern)) {
			best, found = r, true
		}
	}
	return best, found
}

func equalRewrite(a, b contract.DNSRewrite) bool {
	return a.Pattern == b.Pattern && a.Kind == b.Kind && slices.Equal(a.Addresses, b.Addresses) &&
		a.Target == b.Target && a.TTL == b.TTL && a.Enabled == b.Enabled
}

func cloneSettings(s contract.DNSSettings) contract.DNSSettings {
	s.Rewrites = slices.Clone(s.Rewrites)
	for i := range s.Rewrites {
		s.Rewrites[i].Addresses = slices.Clone(s.Rewrites[i].Addresses)
	}
	if s.Rewrites == nil {
		s.Rewrites = []contract.DNSRewrite{}
	}
	return s
}
