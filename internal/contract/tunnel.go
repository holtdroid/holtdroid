package contract

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
)

// TunnelUserHeader names the SSH user a tunnel is opened for, so the agent
// can show who is connected.
const TunnelUserHeader = "X-Holtdroid-User"

const TunnelReadLimit = 1 << 20

func TunnelReversePath(port int) string { return "/tunnel/reverse/" + strconv.Itoa(port) }

const TunnelADBPath = "/tunnel/adb"

// AgentADBPath is the browser's ADB connection on the agent's main port,
// reached through the api proxy, which sets TunnelUserHeader.
const AgentADBPath = "/adb"

const (
	ADBClientSSH     = "ssh"
	ADBClientBrowser = "browser"
)

func YamuxConfig() *yamux.Config {
	cfg := yamux.DefaultConfig()
	cfg.LogOutput = io.Discard
	return cfg
}

// TunnelClient opens the agent's tunnel endpoints; only the ssh-gateway uses it.
type TunnelClient struct {
	base string
	hc   *http.Client
}

func NewTunnelClient(baseURL string, hc *http.Client) *TunnelClient {
	if hc == nil {
		hc = http.DefaultClient
	}
	return &TunnelClient{base: strings.TrimRight(baseURL, "/"), hc: hc}
}

func (c *TunnelClient) dial(ctx context.Context, path, user string) (net.Conn, error) {
	ws, resp, err := websocket.Dial(ctx, c.base+path, &websocket.DialOptions{
		HTTPClient: c.hc,
		HTTPHeader: http.Header{TunnelUserHeader: {user}},
	})
	if err != nil {
		if resp != nil && resp.StatusCode != http.StatusSwitchingProtocols {
			defer resp.Body.Close()
			msg, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
			return nil, &StatusError{Status: resp.StatusCode, Detail: strings.TrimSpace(string(msg))}
		}
		return nil, err
	}
	ws.SetReadLimit(TunnelReadLimit)
	return websocket.NetConn(context.WithoutCancel(ctx), ws, websocket.MessageBinary), nil
}

// ADB opens a raw byte stream to the device's adbd.
func (c *TunnelClient) ADB(ctx context.Context, user string) (net.Conn, error) {
	return c.dial(ctx, TunnelADBPath, user)
}

// Reverse publishes the device's localhost:port. Every connection made to it
// on the device arrives as a stream accepted from the returned session;
// closing the session unpublishes the port.
func (c *TunnelClient) Reverse(ctx context.Context, port int, user string) (*yamux.Session, error) {
	conn, err := c.dial(ctx, TunnelReversePath(port), user)
	if err != nil {
		return nil, err
	}
	sess, err := yamux.Server(conn, YamuxConfig())
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("yamux: %w", err)
	}
	return sess, nil
}

const spliceLinger = 30 * time.Second

// Splice copies bytes both ways, passing the size of every chunk to count
// when it is not nil. When one direction ends it is half-closed where the
// other end supports that, and the rest gets spliceLinger to finish.
func Splice(a, b io.ReadWriteCloser, count func(int)) {
	done := make(chan bool, 2)
	pump := func(dst, src io.ReadWriteCloser) {
		_, err := io.Copy(countWriter{dst, count}, src)
		done <- err == nil && closeWrite(dst)
	}
	go pump(a, b)
	go pump(b, a)
	if halfClosed := <-done; halfClosed {
		linger := time.NewTimer(spliceLinger)
		select {
		case <-done:
			linger.Stop()
			closeFully(a)
			closeFully(b)
			return
		case <-linger.C:
		}
	}
	closeFully(a)
	closeFully(b)
	<-done
}

// closeWrite ends only the writing side; closing a yamux stream does that.
func closeWrite(c io.Closer) bool {
	switch c := c.(type) {
	case interface{ CloseWrite() error }:
		return c.CloseWrite() == nil
	case *yamux.Stream:
		return c.Close() == nil
	}
	return false
}

func closeFully(c io.Closer) {
	if d, ok := c.(interface{ SetReadDeadline(t time.Time) error }); ok {
		_ = d.SetReadDeadline(time.Now())
	}
	_ = c.Close()
}

type countWriter struct {
	w     io.Writer
	count func(int)
}

func (c countWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	if c.count != nil && n > 0 {
		c.count(n)
	}
	return n, err
}
