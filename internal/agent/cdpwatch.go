package agent

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/holtdroid/holtdroid/internal/contract"
)

var cdpKinds = []string{"page", "iframe", "worker", "shared_worker", "service_worker"}

type recordingSink interface {
	DevTools(contract.DevToolsEntry)
	Elapsed() int64
}

// devtoolsWatch follows every target of every WebView process for as long as
// the agent runs, so a recording that starts later knows the sockets already
// open and the requests in flight (decision #112). Lines are written only
// while a recording runs.
type devtoolsWatch struct {
	dt    *DevTools
	log   *slog.Logger
	start time.Time

	mu    sync.Mutex
	rec   recordingSink
	recID string
	procs map[string]*cdpProcess
	subs  map[chan contract.DevToolsEntry]struct{}

	images atomic.Bool
	rescan atomic.Int64

	seq      int64
	sockets  liveHistory
	requests liveHistory
}

// How much of the live lines the agent keeps for watchers that come later,
// such as a session page that was reloaded: socket traffic and targets, and
// requests without their bodies, each on its own so one can't push out the
// other.
const (
	socketHistory  = 16 << 20
	requestHistory = 8 << 20
)

type liveHistory struct {
	lines []contract.DevToolsEntry
	kept  int
	max   int
}

func (h *liveHistory) add(e contract.DevToolsEntry) {
	h.lines = append(h.lines, e)
	h.kept += lineSize(e)
	drop := 0
	for h.kept > h.max && drop < len(h.lines)-1 {
		h.kept -= lineSize(h.lines[drop])
		drop++
	}
	if drop > 0 {
		h.lines = append(h.lines[:0:0], h.lines[drop:]...)
	}
}

func lineSize(e contract.DevToolsEntry) int {
	n := 256
	if e.Frame != nil {
		n += len(e.Frame.Data)
	}
	if e.Socket != nil {
		n += len(e.Socket.URL)
	}
	if e.Page != nil {
		n += len(e.Page.URL) + len(e.Page.Title)
	}
	if im := e.Images; im != nil {
		n += len(im.URL)
		for _, u := range im.Uses {
			n += 64 + len(u.Src) + len(u.Fit)
		}
		for _, svg := range im.SVGs {
			n += len(svg)
		}
	}
	if r := e.Request; r != nil {
		n += len(r.URL) + len(r.Redirect) + len(r.Error)
		for k, v := range r.RequestHeaders {
			n += len(k) + len(v)
		}
		for k, v := range r.ResponseHeaders {
			n += len(k) + len(v)
		}
	}
	return n
}

func newDevToolsWatch(dt *DevTools, log *slog.Logger) *devtoolsWatch {
	return &devtoolsWatch{
		dt: dt, log: log, start: time.Now(), procs: map[string]*cdpProcess{}, subs: map[chan contract.DevToolsEntry]struct{}{},
		sockets: liveHistory{max: socketHistory}, requests: liveHistory{max: requestHistory},
	}
}

func (w *devtoolsWatch) Clock() int64 { return time.Since(w.start).Milliseconds() + 1 }

func (w *devtoolsWatch) At(clock int64) int64 {
	w.mu.Lock()
	rec := w.rec
	w.mu.Unlock()
	if rec == nil {
		return 0
	}
	return max(1, rec.Elapsed()-(w.Clock()-clock))
}

func (w *devtoolsWatch) Recording() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.rec != nil
}

func (w *devtoolsWatch) DevTools(e contract.DevToolsEntry) {
	w.mu.Lock()
	rec := w.rec
	w.mu.Unlock()
	if rec != nil {
		rec.DevTools(e)
	}
}

func (w *devtoolsWatch) ImageScan() bool { return w.images.Load() }

func (w *devtoolsWatch) ImageEpoch() int64 { return w.rescan.Load() }

// Watching is always true: live lines are kept for later watchers too.
func (w *devtoolsWatch) Watching() bool { return true }

// Live stamps a line with the agent's clock, the recording time and a
// number, keeps it in the history and hands it to everyone watching; a
// watcher that falls behind misses lines.
func (w *devtoolsWatch) Live(e contract.DevToolsEntry) {
	w.mu.Lock()
	e = w.stampLocked(e)
	w.seq++
	e.Seq = w.seq
	if e.Request != nil || e.Images != nil {
		w.requests.add(e)
	} else {
		w.sockets.add(e)
	}
	for ch := range w.subs {
		select {
		case ch <- e:
		default:
		}
	}
	w.mu.Unlock()
}

func (w *devtoolsWatch) stampLocked(e contract.DevToolsEntry) contract.DevToolsEntry {
	clock := e.T
	e.Wall = w.start.UnixMilli() + clock - 1
	e.T = 0
	if w.rec != nil {
		e.T, e.Rec = max(1, w.rec.Elapsed()-(w.Clock()-clock)), w.recID
	}
	return e
}

// watchLive sends the kept history in order, then the targets and the
// sockets open now (numbered 0, as they repeat what is known), then every
// change, frame and finished request, until ctx ends or send fails.
func (w *devtoolsWatch) watchLive(ctx context.Context, send func(contract.DevToolsEntry) error) error {
	var current []contract.DevToolsEntry
	for _, p := range w.pages() {
		current = append(current, p.current()...)
	}
	ch := make(chan contract.DevToolsEntry, 1024)
	w.mu.Lock()
	first := make([]contract.DevToolsEntry, 0, len(w.sockets.lines)+len(w.requests.lines)+len(current))
	first = append(append(first, w.sockets.lines...), w.requests.lines...)
	slices.SortFunc(first, func(a, b contract.DevToolsEntry) int { return cmp.Compare(a.Seq, b.Seq) })
	for _, e := range current {
		e.T = w.Clock()
		first = append(first, w.stampLocked(e))
	}
	w.subs[ch] = struct{}{}
	w.mu.Unlock()
	defer func() {
		w.mu.Lock()
		delete(w.subs, ch)
		w.mu.Unlock()
	}()
	for _, e := range first {
		if err := send(e); err != nil {
			return err
		}
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case e := <-ch:
			if err := send(e); err != nil {
				return err
			}
		}
	}
}

// record starts writing into rec, beginning with every target and the
// sockets they have open.
func (w *devtoolsWatch) record(rec recordingSink, id string) {
	w.mu.Lock()
	w.rec, w.recID = rec, id
	w.mu.Unlock()
	w.rescan.Add(1)
	for _, p := range w.pages() {
		p.replay()
	}
}

// stop writes the requests still loading and stops writing into rec.
func (w *devtoolsWatch) stop(rec recordingSink) {
	w.mu.Lock()
	same := w.rec == rec
	w.mu.Unlock()
	if !same {
		return
	}
	for _, p := range w.pages() {
		p.flush()
	}
	w.mu.Lock()
	if w.rec == rec {
		w.rec, w.recID = nil, ""
	}
	w.mu.Unlock()
}

// body hands out a finished request's body while its WebView keeps it.
func (w *devtoolsWatch) body(ctx context.Context, target, request string) (contract.DevToolsBody, error) {
	for _, p := range w.pages() {
		if p.target == target {
			return p.responseBody(ctx, request, cdpBodyLimit)
		}
	}
	return contract.DevToolsBody{}, fmt.Errorf("%w: no target %s", contract.ErrNotFound, target)
}

func (w *devtoolsWatch) pages() []*cdpPage {
	w.mu.Lock()
	procs := make([]*cdpProcess, 0, len(w.procs))
	for _, p := range w.procs {
		procs = append(procs, p)
	}
	w.mu.Unlock()
	var out []*cdpPage
	for _, p := range procs {
		out = append(out, p.list()...)
	}
	return out
}

func (w *devtoolsWatch) run(ctx context.Context, interval time.Duration) {
	for {
		for _, name := range w.dt.socketNames() {
			w.mu.Lock()
			_, known := w.procs[name]
			if !known {
				p := &cdpProcess{w: w, socket: name, pages: map[string]*cdpPage{}}
				w.procs[name] = p
				go func() {
					p.run(ctx)
					w.mu.Lock()
					delete(w.procs, name)
					w.mu.Unlock()
				}()
			}
			w.mu.Unlock()
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

// cdpProcess is one WebView process's DevTools socket.
type cdpProcess struct {
	w       *devtoolsWatch
	socket  string
	process string

	mu    sync.Mutex
	pages map[string]*cdpPage
}

func (p *cdpProcess) list() []*cdpPage {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]*cdpPage, 0, len(p.pages))
	for _, pg := range p.pages {
		out = append(out, pg)
	}
	return out
}

func (p *cdpProcess) dial(ctx context.Context, path string) (*cdpConn, error) {
	s, ok := p.w.dt.socket(p.socket)
	if !ok {
		return nil, errors.New("the socket went away")
	}
	p.process = s.process
	c, resp, err := websocket.Dial(ctx, fmt.Sprintf("ws://127.0.0.1:%d%s", s.port, path), &websocket.DialOptions{Host: "localhost"})
	if resp != nil && resp.Body != nil {
		resp.Body.Close()
	}
	if err != nil {
		return nil, err
	}
	c.SetReadLimit(64 << 20)
	return newCDPConn(c), nil
}

// run attaches to the browser target and from there to every target as it
// starts, paused until its domains are on so nothing it sends is missed.
// A WebView without a browser target gets its pages followed one by one.
func (p *cdpProcess) run(ctx context.Context) {
	conn, err := p.dial(ctx, "/devtools/browser")
	if err != nil {
		p.w.log.Debug("devtools watch: no browser target, following pages", "socket", p.socket, "err", err)
		p.legacy(ctx)
		return
	}
	defer conn.close()
	sessions := map[string]*cdpPage{}
	byTarget := map[string]string{}
	go func() {
		auto := map[string]any{"autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true}
		if _, err := conn.call(ctx, "", "Target.setDiscoverTargets", map[string]any{"discover": true}); err != nil {
			p.w.log.Debug("devtools watch: discover", "err", err)
		}
		if _, err := conn.call(ctx, "", "Target.setAutoAttach", auto); err != nil {
			p.w.log.Debug("devtools watch: auto-attach", "err", err)
		}
	}()
	conn.read(ctx, func(session, method string, raw json.RawMessage) {
		if session != "" {
			if pg := sessions[session]; pg != nil {
				pg.handle(method, raw)
			}
			if method != "Target.attachedToTarget" && method != "Target.detachedFromTarget" {
				return
			}
		}
		switch method {
		case "Target.attachedToTarget":
			var e struct {
				SessionID  string        `json:"sessionId"`
				TargetInfo cdpTargetInfo `json:"targetInfo"`
				Waiting    bool          `json:"waitingForDebugger"`
			}
			if json.Unmarshal(raw, &e) != nil {
				return
			}
			parent := ""
			if pg := sessions[session]; pg != nil {
				parent = pg.target
			}
			if _, dup := byTarget[e.TargetInfo.TargetID]; dup || !slices.Contains(cdpKinds, e.TargetInfo.Type) {
				go func() { _, _ = conn.call(ctx, e.SessionID, "Runtime.runIfWaitingForDebugger", nil) }()
				return
			}
			pg := newCDPPage(e.TargetInfo.TargetID, p.w)
			pg.kind, pg.parent = e.TargetInfo.Type, parent
			pg.call = func(ctx context.Context, method string, params any) (json.RawMessage, error) {
				return conn.call(ctx, e.SessionID, method, params)
			}
			sessions[e.SessionID] = pg
			byTarget[e.TargetInfo.TargetID] = e.SessionID
			p.mu.Lock()
			p.pages[e.SessionID] = pg
			p.mu.Unlock()
			pg.describe(e.TargetInfo.page(p.process))
			go p.prepare(ctx, conn, e.SessionID, e.Waiting)
			go pg.watchImages(ctx)
		case "Target.detachedFromTarget":
			var e struct {
				SessionID string `json:"sessionId"`
			}
			if json.Unmarshal(raw, &e) != nil {
				return
			}
			pg := sessions[e.SessionID]
			if pg == nil {
				return
			}
			delete(sessions, e.SessionID)
			delete(byTarget, pg.target)
			p.mu.Lock()
			delete(p.pages, e.SessionID)
			p.mu.Unlock()
			p.close(pg)
		case "Target.targetInfoChanged":
			var e struct {
				TargetInfo cdpTargetInfo `json:"targetInfo"`
			}
			if json.Unmarshal(raw, &e) != nil {
				return
			}
			if pg := sessions[byTarget[e.TargetInfo.TargetID]]; pg != nil {
				pg.describe(e.TargetInfo.page(p.process))
			}
		}
	})
	for _, pg := range sessions {
		p.close(pg)
	}
}

func (p *cdpProcess) close(pg *cdpPage) {
	pg.flush()
	pg.mu.Lock()
	info := pg.page
	pg.mu.Unlock()
	info.Closed = true
	pg.describe(info)
}

// prepare turns a new target's domains on, makes it attach its own iframes
// and workers, and lets it run. The commands are pipelined: a paused target
// answers some of them (Runtime.enable) only once it runs.
func (p *cdpProcess) prepare(ctx context.Context, conn *cdpConn, session string, waiting bool) {
	for _, m := range []struct {
		method string
		params any
	}{
		{"Network.enable", map[string]any{"maxPostDataSize": cdpPostLimit, "maxTotalBufferSize": 32 << 20, "maxResourceBufferSize": 2 << 20}},
		{"Runtime.enable", nil},
		{"Log.enable", nil},
		{"Target.setAutoAttach", map[string]any{"autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true}},
	} {
		wait, err := conn.send(ctx, session, m.method, m.params)
		if err != nil {
			p.w.log.Debug("devtools watch: enable", "session", session, "method", m.method, "err", err)
			continue
		}
		go func() {
			if _, err := wait(); err != nil {
				p.w.log.Debug("devtools watch: enable", "session", session, "method", m.method, "err", err)
			}
		}()
	}
	if waiting {
		_, _ = conn.call(ctx, session, "Runtime.runIfWaitingForDebugger", nil)
	}
}

// legacy follows the socket's pages over their own connections, polling the
// target list.
func (p *cdpProcess) legacy(ctx context.Context) {
	for {
		if _, ok := p.w.dt.socket(p.socket); !ok {
			return
		}
		targets, _ := p.w.dt.Targets(ctx)
		for _, t := range targets {
			if t.Socket != p.socket || t.Type != "page" {
				continue
			}
			info := contract.DevToolsPage{Type: "page", Process: t.Process, Title: t.Title, URL: t.URL}
			p.mu.Lock()
			pg, known := p.pages[t.ID]
			if !known {
				pg = newCDPPage(t.ID, p.w)
				p.pages[t.ID] = pg
			}
			p.mu.Unlock()
			pg.describe(info)
			if !known {
				go func() {
					p.followPage(ctx, pg)
					p.mu.Lock()
					delete(p.pages, pg.target)
					p.mu.Unlock()
					p.close(pg)
				}()
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func (p *cdpProcess) followPage(ctx context.Context, pg *cdpPage) {
	conn, err := p.dial(ctx, "/devtools/page/"+pg.target)
	if err != nil {
		return
	}
	defer conn.close()
	pg.mu.Lock()
	pg.call = func(ctx context.Context, method string, params any) (json.RawMessage, error) {
		return conn.call(ctx, "", method, params)
	}
	pg.mu.Unlock()
	go p.prepare(ctx, conn, "", false)
	go pg.watchImages(ctx)
	conn.read(ctx, func(_, method string, raw json.RawMessage) { pg.handle(method, raw) })
}

type cdpTargetInfo struct {
	TargetID string `json:"targetId"`
	Type     string `json:"type"`
	Title    string `json:"title"`
	URL      string `json:"url"`
}

func (t cdpTargetInfo) page(process string) contract.DevToolsPage {
	return contract.DevToolsPage{Process: process, Title: t.Title, URL: t.URL}
}

type cdpReply struct {
	result json.RawMessage
	err    error
}

// cdpConn is a CDP connection whose messages may be for a session of an
// attached target (flat mode).
type cdpConn struct {
	c       *websocket.Conn
	mu      sync.Mutex
	next    int64
	waiting map[int64]chan cdpReply
}

func newCDPConn(c *websocket.Conn) *cdpConn {
	return &cdpConn{c: c, waiting: map[int64]chan cdpReply{}}
}

func (c *cdpConn) close() {
	_ = c.c.CloseNow()
	c.mu.Lock()
	defer c.mu.Unlock()
	for id, ch := range c.waiting {
		ch <- cdpReply{err: errors.New("cdp connection closed")}
		delete(c.waiting, id)
	}
}

func (c *cdpConn) call(ctx context.Context, session, method string, params any) (json.RawMessage, error) {
	wait, err := c.send(ctx, session, method, params)
	if err != nil {
		return nil, err
	}
	return wait()
}

func (c *cdpConn) send(ctx context.Context, session, method string, params any) (func() (json.RawMessage, error), error) {
	c.mu.Lock()
	c.next++
	id := c.next
	ch := make(chan cdpReply, 1)
	c.waiting[id] = ch
	c.mu.Unlock()
	m := map[string]any{"id": id, "method": method, "params": params}
	if session != "" {
		m["sessionId"] = session
	}
	msg, err := json.Marshal(m)
	if err != nil {
		c.forget(id)
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	if err := c.c.Write(ctx, websocket.MessageText, msg); err != nil {
		cancel()
		c.forget(id)
		return nil, err
	}
	return func() (json.RawMessage, error) {
		defer cancel()
		select {
		case r := <-ch:
			return r.result, r.err
		case <-ctx.Done():
			c.forget(id)
			return nil, ctx.Err()
		}
	}, nil
}

func (c *cdpConn) forget(id int64) {
	c.mu.Lock()
	delete(c.waiting, id)
	c.mu.Unlock()
}

func (c *cdpConn) read(ctx context.Context, handle func(session, method string, params json.RawMessage)) {
	for {
		_, data, err := c.c.Read(ctx)
		if err != nil {
			return
		}
		var m struct {
			ID        int64           `json:"id"`
			SessionID string          `json:"sessionId"`
			Method    string          `json:"method"`
			Params    json.RawMessage `json:"params"`
			Result    json.RawMessage `json:"result"`
			Error     *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		if m.Method != "" {
			handle(m.SessionID, m.Method, m.Params)
			continue
		}
		c.mu.Lock()
		ch, ok := c.waiting[m.ID]
		delete(c.waiting, m.ID)
		c.mu.Unlock()
		if !ok {
			continue
		}
		if m.Error != nil {
			ch <- cdpReply{err: errors.New(m.Error.Message)}
		} else {
			ch <- cdpReply{result: m.Result}
		}
	}
}
