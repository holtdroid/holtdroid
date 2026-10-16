package agent

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/coder/websocket"
)

// Display serves noVNC and bridges its WebSocket to a VNC server.
type Display struct {
	static string
	vnc    string
	log    *slog.Logger
}

func NewDisplay(static, vnc string, log *slog.Logger) *Display {
	return &Display{static: static, vnc: vnc, log: log}
}

func (d *Display) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /display/{$}", d.page)
	mux.HandleFunc("GET /display/websockify", d.bridge)
	mux.Handle("GET /display/", http.StripPrefix("/display/", http.FileServer(http.Dir(d.static))))
}

// page redirects to noVNC with the WebSocket path it must use: noVNC
// resolves "path" against the host root, not against the page.
func (d *Display) page(w http.ResponseWriter, r *http.Request) {
	q := url.Values{
		"autoconnect": {"1"},
		"reconnect":   {"1"},
		"resize":      {"scale"},
		"path":        {strings.TrimPrefix(r.Header.Get("X-Forwarded-Prefix")+"/display/websockify", "/")},
	}
	w.Header().Set("Location", "vnc.html?"+q.Encode())
	w.WriteHeader(http.StatusFound)
}

func (d *Display) bridge(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{"binary"}, InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer func() { _ = ws.CloseNow() }()
	ws.SetReadLimit(1 << 20)

	var dialer net.Dialer
	vnc, err := dialer.DialContext(r.Context(), "tcp", d.vnc)
	if err != nil {
		d.log.Warn("vnc dial", "err", err)
		_ = ws.Close(websocket.StatusTryAgainLater, "screen is not available yet")
		return
	}
	defer vnc.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	conn := websocket.NetConn(ctx, ws, websocket.MessageBinary)
	go func() {
		_, _ = io.Copy(conn, vnc)
		cancel()
	}()
	_, _ = io.Copy(vnc, conn)
}
