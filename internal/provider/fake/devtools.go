package fake

import (
	"context"
	"encoding/base64"
	"fmt"
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
	emit(contract.DevToolsEntry{Type: contract.DevToolsPageEntry, Page: &contract.DevToolsPage{
		Process: d.session().Package, Title: "Shop", URL: "https://shop.example.com/",
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
			request(n, "POST", "https://api.example.com/v1/events", fmt.Sprintf(`{"event":"view","at":%q}`, now.Format(time.RFC3339)), 200, `{"ok":true}`, "")
			frame(false, fmt.Sprintf(`{"type":"price","sku":"A-100","price":12.5,"ts":%d}`, now.UnixMilli()))
		case 3:
			request(n, "GET", "https://cdn.example.net/config.json", "", 0, "", "net::ERR_NAME_NOT_RESOLVED")
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
