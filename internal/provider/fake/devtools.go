package fake

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/recording"
)

// recordDevTools makes up a WebView's traffic for a recording: API calls
// with JSON that carries timestamps, console lines, a JSON WebSocket and a
// socket streaming video that the real agent would stop recording.
func (d *device) recordDevTools(ctx context.Context, rec *recording.Recorder) {
	const target = "F1"
	emit := func(e contract.DevToolsEntry) {
		e.Target = target
		rec.DevTools(e)
	}
	process := d.session().Package
	emit(contract.DevToolsEntry{Type: contract.DevToolsPageEntry, Page: &contract.DevToolsPage{
		Type: "page", Process: process, Title: "Shop", URL: "https://shop.example.com/",
	}})
	rec.DevTools(contract.DevToolsEntry{Target: "F2", Type: contract.DevToolsPageEntry, Page: &contract.DevToolsPage{
		Type: "iframe", Parent: target, Process: process, URL: "https://pay.example.net/widget",
	}})
	rec.DevTools(contract.DevToolsEntry{Target: "W1", Type: contract.DevToolsPageEntry, Page: &contract.DevToolsPage{
		Type: "service_worker", Process: process, URL: "https://shop.example.com/sw.js",
	}})
	request := func(n int, method, url, post string, status int, body string, fail string) {
		start := rec.Elapsed()
		now := time.Now()
		r := contract.DevToolsRequest{
			ID: "fake." + strconv.Itoa(n), Start: start, Response: start + 38, End: start + 52, Wall: now.UnixMilli(),
			Method: method, URL: url, ResourceType: "Fetch",
			RequestHeaders: map[string]string{"Accept": "application/json", "Authorization": "Bearer fake-token", "User-Agent": "Mozilla/5.0 (Linux; Android 15; wv)"},
			PostData:       post,
			Timing:         &contract.DevToolsTiming{Blocked: 1.2, DNS: -1, Connect: -1, SSL: -1, Send: 0.4, Wait: 36.1, Receive: 14.3},
		}
		if fail != "" {
			r.Response, r.Timing, r.Error = 0, nil, fail
		} else {
			r.Status, r.StatusText, r.MimeType, r.Protocol, r.RemoteAddress = status, "OK", "application/json", "h2", "203.0.113.10:443"
			r.ResponseHeaders = map[string]string{"content-type": "application/json; charset=utf-8", "date": now.UTC().Format(time.RFC1123), "cache-control": "no-store"}
			r.Body, r.Size = body, int64(len(body)+180)
		}
		emit(contract.DevToolsEntry{T: r.End, Type: contract.DevToolsRequestEntry, Request: &r})
	}
	console := func(level, kind, text string, args ...contract.DevToolsValue) {
		emit(contract.DevToolsEntry{Type: contract.DevToolsConsoleEntry, Console: &contract.DevToolsConsole{
			Source: "console", Level: level, Kind: kind, Text: text, Args: args, URL: "https://shop.example.com/assets/app.js", Line: 214, Column: 17, Wall: time.Now().UnixMilli(),
		}})
	}
	socket := func(id, url, state string, frames int, bytes int64) {
		emit(contract.DevToolsEntry{Type: contract.DevToolsSocketEntry, Socket: &contract.DevToolsSocket{ID: id, URL: url, State: state, Status: 101, Frames: frames, Bytes: bytes}})
	}
	frame := func(sent bool, data string) {
		emit(contract.DevToolsEntry{Type: contract.DevToolsFrameEntry, Frame: &contract.DevToolsFrame{Socket: "ws.1", Sent: sent, Opcode: 1, Size: len(data), Data: data}})
	}

	socket("ws.1", "wss://rt.example.com/socket", "open", 0, 0)
	socket("ws.3", "wss://api.example.com/socket.io/?EIO=4&transport=websocket", "open", 0, 0)
	io := func(sent bool, data string) {
		emit(contract.DevToolsEntry{Type: contract.DevToolsFrameEntry, Frame: &contract.DevToolsFrame{Socket: "ws.3", Sent: sent, Opcode: 1, Size: len(data), Data: data}})
	}
	io(false, `0{"sid":"Lbo5JLzTotvW3g2LAAAA","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}`)
	io(true, "40")
	io(false, `40{"sid":"wZX3oN0bSVIhsaknAAAI"}`)
	socket("ws.2", "wss://cam.example.com/stream", "open", 0, 0)
	frame(true, `{"op":"subscribe","topics":["cart","prices"]}`)
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	for n := 1; ; n++ {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		now := time.Now()
		switch n % 4 {
		case 1:
			request(n, "GET", "https://api.example.com/v1/cart", "", 200, fmt.Sprintf(
				`{"id":"c-%d","items":[{"sku":"A-100","qty":2,"price":12.5}],"updatedAt":%q,"expiresAt":%d,"serverTime":%d}`,
				n, now.UTC().Format(time.RFC3339Nano), now.Add(time.Hour).Unix(), now.Add(-3*time.Second).UnixMilli()), "")
			console("info", "log", "cart loaded", contract.DevToolsValue{Type: "string", Text: "cart loaded"},
				contract.DevToolsValue{Type: "object", Text: "{id: 'c-1', items: Array(1)}", JSON: fmt.Sprintf(`{"id":"c-%d","lastSync":%d}`, n, now.UnixMilli())})
		case 2:
			io(false, fmt.Sprintf(`42["cart:update",{"items":2,"total":25,"updatedAt":%d}]`, now.UnixMilli()))
			io(false, "2")
			io(true, "3")
			rec.DevTools(contract.DevToolsEntry{Target: "F2", Type: contract.DevToolsConsoleEntry, Console: &contract.DevToolsConsole{
				Source: "console", Level: "info", Kind: "log", Text: "payment widget ready",
			}})
			request(n, "POST", "https://api.example.com/v1/events", fmt.Sprintf(`{"event":"view","at":%q}`, now.Format(time.RFC3339)), 200, `{"ok":true}`, "")
			frame(false, fmt.Sprintf(`{"type":"price","sku":"A-100","price":12.5,"ts":%d}`, now.UnixMilli()))
		case 3:
			request(n, "GET", "https://cdn.example.net/config.json", "", 0, "", "net::ERR_NAME_NOT_RESOLVED")
			for i := range 3 {
				r := assetRequest(n+i, now)
				r.ID = "fake.asset." + strconv.Itoa(n+i)
				r.Start = rec.Elapsed()
				r.Response, r.End = r.Start+21, r.Start+34
				emit(contract.DevToolsEntry{T: r.End, Type: contract.DevToolsRequestEntry, Request: &r})
			}
			console("warning", "warn", "config unavailable, using defaults")
		case 0:
			frame(true, `{"op":"ping"}`)
			frame(false, `{"op":"pong"}`)
			if n == 4 {
				socket("ws.2", "wss://cam.example.com/stream", "stream", 61, 2_400_000)
				emit(contract.DevToolsEntry{Type: contract.DevToolsFrameEntry, Frame: &contract.DevToolsFrame{
					Socket: "ws.1", Opcode: 2, Size: 6, Data: base64.StdEncoding.EncodeToString([]byte{0x08, 0x96, 0x01, 0x12, 0x01, 0x41}),
				}})
				emit(contract.DevToolsEntry{Type: contract.DevToolsConsoleEntry, Console: &contract.DevToolsConsole{
					Source: "exception", Level: "error", Text: "Uncaught TypeError: Cannot read properties of undefined (reading 'total')",
					URL: "https://shop.example.com/assets/app.js", Line: 88, Column: 31,
					Stack: "    at renderTotal (https://shop.example.com/assets/app.js:88:31)\n    at onCart (https://shop.example.com/assets/app.js:214:17)",
				}})
			}
		}
	}
}

// WatchDevTools makes up live traffic: the page, a JSON WebSocket and a
// Socket.IO one with a frame every two seconds, and a request to a CDN.
func (d *device) WatchDevTools(ctx context.Context, send func(contract.DevToolsEntry) error) error {
	const target = "F1"
	started := time.Now()
	line := func(e contract.DevToolsEntry) error {
		e.Target, e.Wall = target, time.Now().UnixMilli()
		if id, at := d.recordingNow(); id != "" {
			e.Rec, e.T = id, max(1, time.Since(at).Milliseconds())
		}
		return send(e)
	}
	for _, e := range []contract.DevToolsEntry{
		{Type: contract.DevToolsPageEntry, Page: &contract.DevToolsPage{Type: "page", Process: d.session().Package, Title: "Shop", URL: "https://shop.example.com/"}},
		{Type: contract.DevToolsSocketEntry, Socket: &contract.DevToolsSocket{ID: "ws.1", URL: "wss://rt.example.com/socket", State: "open", Status: 101}},
		{Type: contract.DevToolsSocketEntry, Socket: &contract.DevToolsSocket{ID: "ws.3", URL: "wss://api.example.com/socket.io/?EIO=4&transport=websocket", State: "open", Status: 101}},
	} {
		if err := line(e); err != nil {
			return err
		}
	}
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	for n := 1; ; n++ {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}
		now := time.Now()
		frames := []contract.DevToolsFrame{
			{Socket: "ws.1", Opcode: 1, Data: fmt.Sprintf(`{"type":"price","sku":"A-100","price":%d.5,"ts":%d}`, 10+n%5, now.UnixMilli())},
			{Socket: "ws.3", Opcode: 1, Data: fmt.Sprintf(`42["cart:update",{"items":%d,"updatedAt":%q,"uptime":%d}]`, n%4, now.UTC().Format(time.RFC3339Nano), int(time.Since(started).Seconds()))},
		}
		if n%3 == 0 {
			frames = append(frames, contract.DevToolsFrame{Socket: "ws.1", Sent: true, Opcode: 1, Data: `{"op":"ping"}`})
		}
		r := assetRequest(n, now)
		r.Start = time.Since(started).Milliseconds()
		r.Response, r.End = r.Start+21, r.Start+34
		if err := line(contract.DevToolsEntry{Type: contract.DevToolsRequestEntry, Request: &r}); err != nil {
			return err
		}
		for _, f := range frames {
			f.Size = len(f.Data)
			if err := line(contract.DevToolsEntry{Type: contract.DevToolsFrameEntry, Frame: &f}); err != nil {
				return err
			}
		}
	}
}

// assetRequest is the n-th of a round of requests whose caching goes wrong
// in the usual ways, for the Cache tab: an immutable bundle Cloudflare
// serves, an image without caching headers, an API call with a timestamp in
// the URL, a stylesheet with a session cookie, a font that revalidates.
func assetRequest(n int, now time.Time) contract.DevToolsRequest {
	date := now.UTC().Format(http.TimeFormat)
	r := contract.DevToolsRequest{
		ID: "fake.cdn." + strconv.Itoa(n), Wall: now.UnixMilli(), Method: "GET", Status: 200, StatusText: "OK",
		Protocol: "h2", RemoteAddress: "203.0.113.20:443",
		RequestHeaders: map[string]string{"Accept": "*/*", "User-Agent": "Mozilla/5.0 (Linux; Android 15; wv)"},
		Timing:         &contract.DevToolsTiming{Blocked: 0.8, DNS: -1, Connect: -1, SSL: -1, Send: 0.2, Wait: 19.4, Receive: 12.1},
	}
	cf := func(status string, h map[string]string) map[string]string {
		h["date"], h["server"], h["cf-ray"], h["cf-cache-status"] = date, "cloudflare", "8f1c2a3b4c5d6e7f-WAW", status
		return h
	}
	switch n % 5 {
	case 0:
		r.URL, r.ResourceType, r.MimeType = "https://shop.example.com/assets/app.3f9a8c1d.js", "Script", "application/javascript"
		r.ResponseHeaders = cf("HIT", map[string]string{"cache-control": "public, max-age=31536000, immutable", "age": "5120", "etag": `"3f9a8c1d"`})
		r.Size = 182_400
		if n >= 5 {
			r.Cached, r.Size, r.Timing = "memory", 0, nil
		}
	case 1:
		r.URL, r.ResourceType, r.MimeType = "https://shop.example.com/assets/logo.png", "Image", "image/png"
		r.ResponseHeaders = cf("DYNAMIC", map[string]string{"content-type": "image/png"})
		r.Size = 48_210
	case 2:
		r.URL, r.ResourceType, r.MimeType = "https://api.example.com/v1/catalog?lang=en&_="+strconv.FormatInt(now.UnixMilli()-40, 10), "Fetch", "application/json"
		r.ResponseHeaders = cf("MISS", map[string]string{"cache-control": "public, max-age=300", "content-type": "application/json", "vary": "Accept-Encoding, User-Agent"})
		r.Size = 12_800
	case 3:
		r.URL, r.ResourceType, r.MimeType = "https://shop.example.com/styles.css", "Stylesheet", "text/css"
		r.ResponseHeaders = cf("BYPASS", map[string]string{"cache-control": "no-cache", "set-cookie": "sid=fake; Path=/; HttpOnly"})
		r.Size = 23_100
	default:
		r.URL, r.ResourceType, r.MimeType = "https://cdn.example.net/fonts/inter.woff2", "Font", "font/woff2"
		r.ResponseHeaders = map[string]string{"date": date, "cache-control": "max-age=0, must-revalidate", "etag": `"inter-4"`, "last-modified": "Tue, 01 Oct 2024 10:00:00 GMT"}
		r.Size = 96_000
		if n >= 5 {
			r.Status, r.StatusText, r.Size = 304, "Not Modified", 180
		}
	}
	return r
}
