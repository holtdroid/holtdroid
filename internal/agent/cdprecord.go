package agent

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const (
	cdpBodyLimit    = 1 << 20
	cdpPostLimit    = 256 << 10
	cdpTextFrame    = 128 << 10
	cdpBinaryFrame  = 16 << 10
	cdpJSONLimit    = 64 << 10
	cdpStreamWindow = 4000
	cdpStreamBytes  = 1 << 20
	cdpStreamFrames = 60
	cdpMediaFrames  = 3
)

type devtoolsSink interface {
	DevTools(contract.DevToolsEntry)
	// Clock is the watch's own time in milliseconds, which runs with or
	// without a recording; At turns one of its times into recording time.
	Clock() int64
	At(clock int64) int64
	Recording() bool
}

// cdpPage turns one target's CDP events into recording lines: a page, an
// iframe or a worker.
type cdpPage struct {
	target string
	kind   string
	parent string
	sink   devtoolsSink
	call   func(ctx context.Context, method string, params any) (json.RawMessage, error)
	slots  chan struct{}

	mu        sync.Mutex
	page      contract.DevToolsPage
	requests  map[string]*cdpRequest
	redirects map[string]int
	sockets   map[string]*cdpSocket
}

type cdpRequest struct {
	contract.DevToolsRequest
	sentAt      float64
	timing      *cdpTiming
	cachedEvent bool
}

type cdpSocket struct {
	contract.DevToolsSocket
	window []cdpFrameStat
	since  int64
	media  int
}

type cdpFrameStat struct {
	t      int64
	size   int
	binary bool
}

func newCDPPage(target string, sink devtoolsSink) *cdpPage {
	return &cdpPage{
		target: target, kind: "page", sink: sink, slots: make(chan struct{}, 4),
		requests: map[string]*cdpRequest{}, redirects: map[string]int{}, sockets: map[string]*cdpSocket{},
	}
}

// emit writes a line while a recording runs; its times are the watch's
// clock until here, and a T of 0 is now.
func (p *cdpPage) emit(e contract.DevToolsEntry) {
	if !p.sink.Recording() {
		return
	}
	e.Target = p.target
	if e.T <= 0 {
		e.T = p.sink.Clock()
	}
	e.T = p.sink.At(e.T)
	if e.Request != nil {
		r := *e.Request
		r.Start = p.sink.At(r.Start)
		if r.Response > 0 {
			r.Response = p.sink.At(r.Response)
		}
		if r.End > 0 {
			r.End = p.sink.At(r.End)
		}
		e.Request = &r
	}
	p.sink.DevTools(e)
}

// replay writes what a recording that starts now needs to know: the target
// and the sockets already open.
func (p *cdpPage) replay() {
	p.mu.Lock()
	page := p.page
	sockets := make([]contract.DevToolsSocket, 0, len(p.sockets))
	for _, s := range p.sockets {
		sockets = append(sockets, s.DevToolsSocket)
	}
	p.mu.Unlock()
	p.emit(contract.DevToolsEntry{Type: contract.DevToolsPageEntry, Page: &page})
	for _, s := range sockets {
		p.emit(contract.DevToolsEntry{Type: contract.DevToolsSocketEntry, Socket: &s})
	}
}

func (p *cdpPage) describe(info contract.DevToolsPage) {
	info.Type, info.Parent = p.kind, p.parent
	p.mu.Lock()
	if info == p.page {
		p.mu.Unlock()
		return
	}
	p.page = info
	p.mu.Unlock()
	p.emit(contract.DevToolsEntry{Type: contract.DevToolsPageEntry, Page: &info})
}

func (p *cdpPage) flush() {
	p.mu.Lock()
	pending := make([]*cdpRequest, 0, len(p.requests))
	for id, r := range p.requests {
		pending = append(pending, r)
		delete(p.requests, id)
	}
	p.mu.Unlock()
	for _, r := range pending {
		req := r.DevToolsRequest
		p.emit(contract.DevToolsEntry{Type: contract.DevToolsRequestEntry, Request: &req})
	}
}

// background runs f without holding up the page's events, a few at a time.
func (p *cdpPage) background(f func(ctx context.Context)) {
	if p.call == nil || !p.sink.Recording() {
		return
	}
	go func() {
		p.slots <- struct{}{}
		defer func() { <-p.slots }()
		f(context.Background())
	}()
}

type cdpHeaders map[string]any

func (h cdpHeaders) strings() map[string]string {
	if len(h) == 0 {
		return nil
	}
	out := make(map[string]string, len(h))
	for k, v := range h {
		if s, ok := v.(string); ok {
			out[k] = s
		} else {
			out[k] = fmt.Sprint(v)
		}
	}
	return out
}

type cdpTiming struct {
	RequestTime       float64 `json:"requestTime"`
	DNSStart          float64 `json:"dnsStart"`
	DNSEnd            float64 `json:"dnsEnd"`
	ConnectStart      float64 `json:"connectStart"`
	ConnectEnd        float64 `json:"connectEnd"`
	SSLStart          float64 `json:"sslStart"`
	SSLEnd            float64 `json:"sslEnd"`
	SendStart         float64 `json:"sendStart"`
	SendEnd           float64 `json:"sendEnd"`
	ReceiveHeadersEnd float64 `json:"receiveHeadersEnd"`
}

type cdpResponse struct {
	URL               string     `json:"url"`
	Status            int        `json:"status"`
	StatusText        string     `json:"statusText"`
	Headers           cdpHeaders `json:"headers"`
	MimeType          string     `json:"mimeType"`
	RemoteIPAddress   string     `json:"remoteIPAddress"`
	RemotePort        int        `json:"remotePort"`
	FromDiskCache     bool       `json:"fromDiskCache"`
	FromServiceWorker bool       `json:"fromServiceWorker"`
	FromPrefetchCache bool       `json:"fromPrefetchCache"`
	EncodedDataLength float64    `json:"encodedDataLength"`
	Timing            *cdpTiming `json:"timing"`
	Protocol          string     `json:"protocol"`
}

type cdpStack struct {
	CallFrames []struct {
		FunctionName string `json:"functionName"`
		URL          string `json:"url"`
		LineNumber   int    `json:"lineNumber"`
		ColumnNumber int    `json:"columnNumber"`
	} `json:"callFrames"`
}

func (s *cdpStack) format() (stack, url string, line, col int) {
	if s == nil || len(s.CallFrames) == 0 {
		return "", "", 0, 0
	}
	var b strings.Builder
	for _, f := range s.CallFrames {
		name := f.FunctionName
		if name == "" {
			name = "(anonymous)"
		}
		fmt.Fprintf(&b, "    at %s (%s:%d:%d)\n", name, f.URL, f.LineNumber+1, f.ColumnNumber+1)
	}
	top := s.CallFrames[0]
	return strings.TrimRight(b.String(), "\n"), top.URL, top.LineNumber + 1, top.ColumnNumber + 1
}

type cdpObject struct {
	Type                string          `json:"type"`
	Subtype             string          `json:"subtype"`
	ClassName           string          `json:"className"`
	Value               json.RawMessage `json:"value"`
	UnserializableValue string          `json:"unserializableValue"`
	Description         string          `json:"description"`
	ObjectID            string          `json:"objectId"`
	Preview             *cdpPreview     `json:"preview"`
}

type cdpPreview struct {
	Subtype     string `json:"subtype"`
	Description string `json:"description"`
	Overflow    bool   `json:"overflow"`
	Properties  []struct {
		Name    string `json:"name"`
		Type    string `json:"type"`
		Subtype string `json:"subtype"`
		Value   string `json:"value"`
	} `json:"properties"`
}

func (p *cdpPage) handle(method string, raw json.RawMessage) {
	switch method {
	case "Runtime.consoleAPICalled", "Runtime.exceptionThrown", "Log.entryAdded":
		if !p.sink.Recording() {
			return
		}
	}
	switch method {
	case "Network.requestWillBeSent":
		var e struct {
			RequestID string  `json:"requestId"`
			Timestamp float64 `json:"timestamp"`
			WallTime  float64 `json:"wallTime"`
			Type      string  `json:"type"`
			Request   struct {
				URL         string     `json:"url"`
				Method      string     `json:"method"`
				Headers     cdpHeaders `json:"headers"`
				PostData    string     `json:"postData"`
				HasPostData bool       `json:"hasPostData"`
			} `json:"request"`
			RedirectResponse *cdpResponse `json:"redirectResponse"`
		}
		if json.Unmarshal(raw, &e) != nil {
			return
		}
		now := p.sink.Clock()
		var redirected *contract.DevToolsRequest
		p.mu.Lock()
		if prev, ok := p.requests[e.RequestID]; ok && e.RedirectResponse != nil {
			delete(p.requests, e.RequestID)
			prev.respond(e.RedirectResponse, now)
			prev.End, prev.Redirect = now, e.Request.URL
			prev.finishTiming(e.Timestamp)
			redirected = &prev.DevToolsRequest
		}
		id := e.RequestID
		if n := p.redirects[e.RequestID]; e.RedirectResponse != nil {
			p.redirects[e.RequestID] = n + 1
			id += ":" + strconv.Itoa(n+1)
		}
		r := &cdpRequest{sentAt: e.Timestamp}
		r.ID, r.Start, r.Method, r.URL, r.ResourceType = id, now, e.Request.Method, e.Request.URL, e.Type
		r.Wall = int64(e.WallTime * 1000)
		r.RequestHeaders = e.Request.Headers.strings()
		r.PostData, r.PostDataTruncated = cut(e.Request.PostData, cdpPostLimit)
		if e.Request.HasPostData && e.Request.PostData == "" {
			r.PostDataTruncated = true
		}
		p.requests[e.RequestID] = r
		p.mu.Unlock()
		if redirected != nil {
			p.emit(contract.DevToolsEntry{T: now, Type: contract.DevToolsRequestEntry, Request: redirected})
		}
	case "Network.requestServedFromCache":
		var e struct {
			RequestID string `json:"requestId"`
		}
		if json.Unmarshal(raw, &e) != nil {
			return
		}
		p.mu.Lock()
		if r, ok := p.requests[e.RequestID]; ok {
			r.cachedEvent = true
		}
		p.mu.Unlock()
	case "Network.responseReceived":
		var e struct {
			RequestID string      `json:"requestId"`
			Response  cdpResponse `json:"response"`
		}
		if json.Unmarshal(raw, &e) != nil {
			return
		}
		now := p.sink.Clock()
		p.mu.Lock()
		if r, ok := p.requests[e.RequestID]; ok {
			r.respond(&e.Response, now)
		}
		p.mu.Unlock()
	case "Network.loadingFinished":
		var e struct {
			RequestID         string  `json:"requestId"`
			Timestamp         float64 `json:"timestamp"`
			EncodedDataLength float64 `json:"encodedDataLength"`
		}
		if json.Unmarshal(raw, &e) != nil {
			return
		}
		now := p.sink.Clock()
		p.mu.Lock()
		r, ok := p.requests[e.RequestID]
		delete(p.requests, e.RequestID)
		p.mu.Unlock()
		if !ok {
			return
		}
		r.End = now
		if e.EncodedDataLength > 0 {
			r.Size = int64(e.EncodedDataLength)
		}
		r.finishTiming(e.Timestamp)
		req := r.DevToolsRequest
		switch {
		case req.ResourceType == "Image" || req.ResourceType == "Media" || req.ResourceType == "Font":
			req.BodySkipped = "type"
		case req.Size > cdpBodyLimit:
			req.BodySkipped = "size"
		case p.call == nil || !p.sink.Recording():
		default:
			p.background(func(ctx context.Context) {
				p.body(ctx, e.RequestID, &req)
				p.emit(contract.DevToolsEntry{T: now, Type: contract.DevToolsRequestEntry, Request: &req})
			})
			return
		}
		p.emit(contract.DevToolsEntry{T: now, Type: contract.DevToolsRequestEntry, Request: &req})
	case "Network.loadingFailed":
		var e struct {
			RequestID     string  `json:"requestId"`
			Timestamp     float64 `json:"timestamp"`
			ErrorText     string  `json:"errorText"`
			Canceled      bool    `json:"canceled"`
			BlockedReason string  `json:"blockedReason"`
		}
		if json.Unmarshal(raw, &e) != nil {
			return
		}
		now := p.sink.Clock()
		p.mu.Lock()
		r, ok := p.requests[e.RequestID]
		delete(p.requests, e.RequestID)
		p.mu.Unlock()
		if !ok {
			return
		}
		r.End, r.Error, r.Canceled = now, e.ErrorText, e.Canceled
		if e.BlockedReason != "" {
			r.Error = strings.TrimSpace(r.Error + " (blocked: " + e.BlockedReason + ")")
		}
		r.finishTiming(e.Timestamp)
		req := r.DevToolsRequest
		p.emit(contract.DevToolsEntry{T: now, Type: contract.DevToolsRequestEntry, Request: &req})
	case "Network.webSocketCreated":
		var e struct {
			RequestID string `json:"requestId"`
			URL       string `json:"url"`
		}
		if json.Unmarshal(raw, &e) != nil {
			return
		}
		s := &cdpSocket{since: p.sink.Clock()}
		s.ID, s.URL, s.State = e.RequestID, e.URL, "connecting"
		p.mu.Lock()
		p.sockets[e.RequestID] = s
		p.mu.Unlock()
		p.emitSocket(s)
	case "Network.webSocketHandshakeResponseReceived":
		var e struct {
			RequestID string `json:"requestId"`
			Response  struct {
				Status int `json:"status"`
			} `json:"response"`
		}
		if json.Unmarshal(raw, &e) != nil {
			return
		}
		p.socketState(e.RequestID, func(s *cdpSocket) bool {
			s.State, s.Status = "open", e.Response.Status
			return true
		})
	case "Network.webSocketFrameError":
		var e struct {
			RequestID    string `json:"requestId"`
			ErrorMessage string `json:"errorMessage"`
		}
		if json.Unmarshal(raw, &e) != nil {
			return
		}
		p.socketState(e.RequestID, func(s *cdpSocket) bool {
			s.Error = e.ErrorMessage
			if s.State != "stream" {
				s.State = "error"
			}
			return true
		})
	case "Network.webSocketClosed":
		var e struct {
			RequestID string `json:"requestId"`
		}
		if json.Unmarshal(raw, &e) != nil {
			return
		}
		p.mu.Lock()
		s, ok := p.sockets[e.RequestID]
		delete(p.sockets, e.RequestID)
		p.mu.Unlock()
		if ok {
			s.State = "closed"
			p.emitSocket(s)
		}
	case "Network.webSocketFrameSent", "Network.webSocketFrameReceived":
		var e struct {
			RequestID string `json:"requestId"`
			Response  struct {
				Opcode      int    `json:"opcode"`
				PayloadData string `json:"payloadData"`
			} `json:"response"`
		}
		if json.Unmarshal(raw, &e) != nil || (e.Response.Opcode != 1 && e.Response.Opcode != 2) {
			return
		}
		p.frame(e.RequestID, method == "Network.webSocketFrameSent", e.Response.Opcode, e.Response.PayloadData)
	case "Network.eventSourceMessageReceived":
		var e struct {
			RequestID string `json:"requestId"`
			Data      string `json:"data"`
		}
		if json.Unmarshal(raw, &e) != nil {
			return
		}
		p.mu.Lock()
		if _, ok := p.sockets[e.RequestID]; !ok {
			s := &cdpSocket{since: p.sink.Clock()}
			s.ID, s.State = e.RequestID, "open"
			if r, ok := p.requests[e.RequestID]; ok {
				s.URL = r.URL
			}
			p.sockets[e.RequestID] = s
			p.mu.Unlock()
			p.emitSocket(s)
		} else {
			p.mu.Unlock()
		}
		p.frame(e.RequestID, false, 1, e.Data)
	case "Runtime.consoleAPICalled":
		var e struct {
			Type       string      `json:"type"`
			Args       []cdpObject `json:"args"`
			Timestamp  float64     `json:"timestamp"`
			StackTrace *cdpStack   `json:"stackTrace"`
		}
		if json.Unmarshal(raw, &e) != nil {
			return
		}
		now := p.sink.Clock()
		c := contract.DevToolsConsole{Source: "console", Level: consoleLevel(e.Type), Kind: e.Type, Wall: int64(e.Timestamp)}
		c.Stack, c.URL, c.Line, c.Column = e.StackTrace.format()
		if e.Type != "trace" && e.Type != "error" && e.Type != "warning" && e.Type != "assert" {
			c.Stack = ""
		}
		args := e.Args
		if !slices.ContainsFunc(args, jsonable) || p.call == nil {
			c.Args = valuesOf(args, nil)
			c.Text = consoleText(c.Args)
			p.emit(contract.DevToolsEntry{T: now, Type: contract.DevToolsConsoleEntry, Console: &c})
			return
		}
		p.background(func(ctx context.Context) {
			c.Args = valuesOf(args, func(id string) string { return p.objectJSON(ctx, id) })
			c.Text = consoleText(c.Args)
			p.emit(contract.DevToolsEntry{T: now, Type: contract.DevToolsConsoleEntry, Console: &c})
		})
	case "Runtime.exceptionThrown":
		var e struct {
			Timestamp float64 `json:"timestamp"`
			Details   struct {
				Text       string     `json:"text"`
				LineNumber int        `json:"lineNumber"`
				Column     int        `json:"columnNumber"`
				URL        string     `json:"url"`
				StackTrace *cdpStack  `json:"stackTrace"`
				Exception  *cdpObject `json:"exception"`
			} `json:"exceptionDetails"`
		}
		if json.Unmarshal(raw, &e) != nil {
			return
		}
		d := e.Details
		c := contract.DevToolsConsole{Source: "exception", Level: "error", Text: d.Text, URL: d.URL, Line: d.LineNumber + 1, Column: d.Column + 1, Wall: int64(e.Timestamp)}
		if d.Exception != nil {
			c.Args = valuesOf([]cdpObject{*d.Exception}, nil)
			if first, _, _ := strings.Cut(d.Exception.Description, "\n"); first != "" {
				c.Text = strings.TrimSpace(d.Text + " " + first)
			}
		}
		if stack, url, line, col := d.StackTrace.format(); stack != "" {
			c.Stack = stack
			if c.URL == "" {
				c.URL, c.Line, c.Column = url, line, col
			}
		}
		p.emit(contract.DevToolsEntry{Type: contract.DevToolsConsoleEntry, Console: &c})
	case "Log.entryAdded":
		var e struct {
			Entry struct {
				Source     string    `json:"source"`
				Level      string    `json:"level"`
				Text       string    `json:"text"`
				URL        string    `json:"url"`
				LineNumber int       `json:"lineNumber"`
				Timestamp  float64   `json:"timestamp"`
				StackTrace *cdpStack `json:"stackTrace"`
			} `json:"entry"`
		}
		if json.Unmarshal(raw, &e) != nil {
			return
		}
		l := e.Entry
		if l.Source == "worker" {
			return
		}
		level := l.Level
		if level == "verbose" {
			level = "debug"
		}
		c := contract.DevToolsConsole{Source: "browser", Level: level, Kind: l.Source, Text: l.Text, URL: l.URL, Line: l.LineNumber + 1, Wall: int64(l.Timestamp)}
		if l.URL == "" {
			c.Line = 0
		}
		c.Stack, _, _, _ = l.StackTrace.format()
		p.emit(contract.DevToolsEntry{Type: contract.DevToolsConsoleEntry, Console: &c})
	}
}

func (r *cdpRequest) respond(resp *cdpResponse, now int64) {
	r.Response = now
	r.Status, r.StatusText, r.MimeType, r.Protocol = resp.Status, resp.StatusText, resp.MimeType, resp.Protocol
	r.ResponseHeaders = resp.Headers.strings()
	if resp.RemoteIPAddress != "" {
		r.RemoteAddress = resp.RemoteIPAddress
		if resp.RemotePort > 0 {
			r.RemoteAddress = joinHostPort(resp.RemoteIPAddress, resp.RemotePort)
		}
	}
	switch {
	case resp.FromServiceWorker:
		r.Cached = "service-worker"
	case resp.FromPrefetchCache:
		r.Cached = "prefetch"
	case resp.FromDiskCache:
		r.Cached = "disk"
	case r.cachedEvent:
		r.Cached = "memory"
	}
	if resp.EncodedDataLength > 0 {
		r.Size = int64(resp.EncodedDataLength)
	}
	r.timing = resp.Timing
}

func joinHostPort(host string, port int) string {
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		host = "[" + host + "]"
	}
	return host + ":" + strconv.Itoa(port)
}

// finishTiming works out HAR's stages from the response's timing and the
// monotonic time the request ended.
func (r *cdpRequest) finishTiming(end float64) {
	t := r.timing
	if t == nil || t.RequestTime <= 0 {
		return
	}
	span := func(a, b float64) float64 {
		if a < 0 || b < 0 {
			return -1
		}
		return round3(b - a)
	}
	blocked := t.SendStart
	for _, v := range []float64{t.ConnectStart, t.DNSStart} {
		if v >= 0 {
			blocked = v
		}
	}
	queued := 0.0
	if r.sentAt > 0 && t.RequestTime > r.sentAt {
		queued = (t.RequestTime - r.sentAt) * 1000
	}
	receive := 0.0
	if end > 0 {
		receive = max(0, (end-t.RequestTime)*1000-t.ReceiveHeadersEnd)
	}
	r.Timing = &contract.DevToolsTiming{
		Blocked: round3(max(0, blocked) + queued),
		DNS:     span(t.DNSStart, t.DNSEnd),
		Connect: span(t.ConnectStart, t.ConnectEnd),
		SSL:     span(t.SSLStart, t.SSLEnd),
		Send:    max(0, span(t.SendStart, t.SendEnd)),
		Wait:    max(0, span(t.SendEnd, t.ReceiveHeadersEnd)),
		Receive: round3(receive),
	}
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

func (p *cdpPage) body(ctx context.Context, requestID string, req *contract.DevToolsRequest) {
	res, err := p.call(ctx, "Network.getResponseBody", map[string]any{"requestId": requestID})
	var b struct {
		Body          string `json:"body"`
		Base64Encoded bool   `json:"base64Encoded"`
	}
	if err != nil || json.Unmarshal(res, &b) != nil {
		req.BodySkipped = "unavailable"
		return
	}
	limit := cdpBodyLimit
	if b.Base64Encoded {
		limit = base64.StdEncoding.EncodedLen(cdpBodyLimit)
	}
	req.Body, req.BodyTruncated = cut(b.Body, limit)
	req.BodyBase64 = b.Base64Encoded
	if req.BodyTruncated && b.Base64Encoded {
		req.Body = req.Body[:len(req.Body)/4*4]
	}
}

const jsonFunction = `function(){try{const s=JSON.stringify(this,(k,v)=>typeof v==="bigint"?v.toString():v);return s===undefined||s.length>` + "65536" + `?undefined:s}catch(e){return undefined}}`

func (p *cdpPage) objectJSON(ctx context.Context, objectID string) string {
	res, err := p.call(ctx, "Runtime.callFunctionOn", map[string]any{
		"objectId": objectID, "functionDeclaration": jsonFunction, "returnByValue": true, "silent": true,
	})
	if err != nil {
		return ""
	}
	var r struct {
		Result struct {
			Value string `json:"value"`
		} `json:"result"`
	}
	if json.Unmarshal(res, &r) != nil || len(r.Result.Value) > cdpJSONLimit {
		return ""
	}
	return r.Result.Value
}

func jsonable(o cdpObject) bool {
	return o.Type == "object" && o.ObjectID != "" && o.Subtype != "null" && o.Subtype != "error" && o.Subtype != "node" &&
		o.Subtype != "regexp" && o.Subtype != "promise" && o.Subtype != "proxy" && o.Subtype != "weakmap" && o.Subtype != "weakset"
}

func valuesOf(args []cdpObject, toJSON func(objectID string) string) []contract.DevToolsValue {
	out := make([]contract.DevToolsValue, 0, len(args))
	for _, a := range args {
		v := contract.DevToolsValue{Type: a.Type, Subtype: a.Subtype}
		switch {
		case a.Type == "string":
			_ = json.Unmarshal(a.Value, &v.Text)
		case a.UnserializableValue != "":
			v.Text = a.UnserializableValue
		case a.Type == "undefined":
			v.Text = "undefined"
		case a.Subtype == "null":
			v.Text, v.JSON = "null", "null"
		case len(a.Value) > 0 && a.Type != "object":
			v.Text = string(a.Value)
		case a.Preview != nil && a.Type == "object" && a.Subtype != "error":
			v.Text = previewText(a.Preview, a.Description)
		default:
			v.Text = a.Description
		}
		if a.Type == "object" && len(a.Value) > 0 && v.JSON == "" {
			v.JSON = string(a.Value)
		}
		if toJSON != nil && jsonable(a) {
			v.JSON = toJSON(a.ObjectID)
		}
		out = append(out, v)
	}
	return out
}

func previewText(p *cdpPreview, desc string) string {
	array := p.Subtype == "array" || p.Subtype == "typedarray"
	parts := make([]string, 0, len(p.Properties)+1)
	for _, prop := range p.Properties {
		val := prop.Value
		if prop.Type == "string" {
			val = strconv.Quote(val)
		}
		if array {
			parts = append(parts, val)
		} else {
			parts = append(parts, prop.Name+": "+val)
		}
	}
	if p.Overflow {
		parts = append(parts, "…")
	}
	if array {
		return desc + " [" + strings.Join(parts, ", ") + "]"
	}
	prefix := ""
	if desc != "" && desc != "Object" {
		prefix = desc + " "
	}
	return prefix + "{" + strings.Join(parts, ", ") + "}"
}

// consoleText is the message as DevTools prints it: a first string's
// %s, %d, %i, %f, %o, %O and %c take the arguments after it in turn.
func consoleText(args []contract.DevToolsValue) string {
	if len(args) == 0 {
		return ""
	}
	rest := args
	var b strings.Builder
	if first := args[0]; first.Type == "string" && strings.Contains(first.Text, "%") {
		rest = args[1:]
		s := first.Text
		for i := 0; i < len(s); i++ {
			if s[i] != '%' || i+1 >= len(s) {
				b.WriteByte(s[i])
				continue
			}
			switch s[i+1] {
			case 's', 'd', 'i', 'f', 'o', 'O', 'c':
				if len(rest) > 0 {
					if s[i+1] != 'c' {
						b.WriteString(rest[0].Text)
					}
					rest = rest[1:]
				}
				i++
			case '%':
				b.WriteByte('%')
				i++
			default:
				b.WriteByte('%')
			}
		}
	} else {
		b.WriteString(args[0].Text)
		rest = args[1:]
	}
	for _, a := range rest {
		b.WriteByte(' ')
		b.WriteString(a.Text)
	}
	return b.String()
}

func consoleLevel(kind string) string {
	switch kind {
	case "error", "assert":
		return "error"
	case "warning":
		return "warning"
	case "debug":
		return "debug"
	default:
		return "info"
	}
}

func (p *cdpPage) emitSocket(s *cdpSocket) {
	st := s.DevToolsSocket
	p.emit(contract.DevToolsEntry{Type: contract.DevToolsSocketEntry, Socket: &st})
}

func (p *cdpPage) socketState(id string, f func(*cdpSocket) bool) {
	p.mu.Lock()
	s, ok := p.sockets[id]
	changed := ok && f(s)
	p.mu.Unlock()
	if changed {
		p.emitSocket(s)
	}
}

func (p *cdpPage) frame(id string, sent bool, opcode int, payload string) {
	now := p.sink.Clock()
	p.mu.Lock()
	s, known := p.sockets[id]
	if !known {
		s = &cdpSocket{since: now}
		s.ID, s.State = id, "open"
		p.sockets[id] = s
		st := s.DevToolsSocket
		p.mu.Unlock()
		p.emit(contract.DevToolsEntry{T: now, Type: contract.DevToolsSocketEntry, Socket: &st})
		p.mu.Lock()
	}
	binary := opcode == 2
	size := len(payload)
	var head []byte
	if binary {
		size = base64.StdEncoding.DecodedLen(len(payload)) - strings.Count(payload[max(0, len(payload)-2):], "=")
		head, _ = base64.StdEncoding.DecodeString(payload[:min(len(payload), 24)])
	}
	s.Frames++
	s.Bytes += int64(size)
	if s.State == "stream" {
		p.mu.Unlock()
		return
	}
	media := binary && mediaPayload(head)
	if media {
		s.media++
	}
	if s.streaming(now, size, binary) {
		s.State = "stream"
		st := s.DevToolsSocket
		p.mu.Unlock()
		p.emit(contract.DevToolsEntry{Type: contract.DevToolsSocketEntry, Socket: &st})
		return
	}
	p.mu.Unlock()
	f := contract.DevToolsFrame{Socket: id, Sent: sent, Opcode: opcode, Size: size}
	if !media {
		limit := cdpTextFrame
		if binary {
			limit = base64.StdEncoding.EncodedLen(cdpBinaryFrame)
		}
		f.Data, f.Truncated = cut(payload, limit)
		if f.Truncated && binary {
			f.Data = f.Data[:len(f.Data)/4*4]
		}
	}
	p.emit(contract.DevToolsEntry{T: now, Type: contract.DevToolsFrameEntry, Frame: &f})
}

// streaming says whether a socket looks like a video or another media
// stream: a few frames that start like a media container or picture, or a
// steady flow of binary frames or bytes over the last few seconds.
func (s *cdpSocket) streaming(now int64, size int, binary bool) bool {
	if s.media >= cdpMediaFrames {
		return true
	}
	s.window = append(s.window, cdpFrameStat{t: now, size: size, binary: binary})
	drop := 0
	for drop < len(s.window) && s.window[drop].t < now-cdpStreamWindow {
		drop++
	}
	s.window = s.window[drop:]
	if now-s.since < cdpStreamWindow/2 || now-s.window[0].t < cdpStreamWindow/2 {
		return false
	}
	bytes, frames := 0, 0
	for _, f := range s.window {
		bytes += f.size
		if f.binary {
			frames++
		}
	}
	return bytes >= cdpStreamBytes || frames >= cdpStreamFrames
}

func mediaPayload(b []byte) bool {
	has := func(prefix ...byte) bool { return len(b) >= len(prefix) && string(b[:len(prefix)]) == string(prefix) }
	if has(0, 0, 0, 1) || has(0x1a, 0x45, 0xdf, 0xa3) || has('O', 'g', 'g', 'S') ||
		has(0xff, 0xd8, 0xff) || has(0x89, 'P', 'N', 'G') || has('R', 'I', 'F', 'F') || has('F', 'L', 'V') {
		return true
	}
	if len(b) >= 8 {
		switch string(b[4:8]) {
		case "ftyp", "moof", "mdat", "styp", "moov":
			return true
		}
	}
	return false
}

func cut(s string, limit int) (string, bool) {
	if len(s) <= limit {
		return s, false
	}
	for limit > 0 && !utf8.RuneStart(s[limit]) {
		limit--
	}
	return s[:limit], true
}
