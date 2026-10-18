package sshgateway

import (
	"bufio"
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"sync"

	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/contract/control"
)

const maxControlLine = 1 << 20

// clientInfo is the connect client's side of a connection: what it said about
// itself and the channel to tell it about sessions and ports.
type clientInfo struct {
	mu       sync.Mutex
	w        io.Writer
	hello    control.Hello
	state    control.State
	sessions []control.Session
}

func (c *conn) serveControl(ctx context.Context, ch io.ReadWriter) {
	c.client.mu.Lock()
	c.client.w = ch
	c.client.sessions = nil
	c.client.mu.Unlock()
	defer func() {
		c.client.mu.Lock()
		c.client.w = nil
		c.client.mu.Unlock()
	}()
	if err := c.send(control.Message{Type: control.TypeGateway, Gateway: &control.Gateway{
		ADB: c.g.cfg.AllowADB, Publish: c.g.cfg.AllowReverse,
	}}); err != nil {
		return
	}
	c.sendSessions(c.fan.sessions())

	sc := bufio.NewScanner(ch)
	sc.Buffer(make([]byte, 64<<10), maxControlLine)
	for sc.Scan() && ctx.Err() == nil {
		var m control.Message
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			c.log.Info("bad control message", "err", err)
			return
		}
		c.client.mu.Lock()
		switch m.Type {
		case control.TypeHello:
			if m.Hello != nil {
				c.client.hello = *m.Hello
			}
		case control.TypeState:
			if m.State != nil {
				c.client.state = *m.State
			}
		}
		c.client.mu.Unlock()
	}
}

func (c *conn) send(m control.Message) error {
	line, err := json.Marshal(m)
	if err != nil {
		return err
	}
	c.client.mu.Lock()
	defer c.client.mu.Unlock()
	if c.client.w == nil {
		return fmt.Errorf("%w: the client has no control channel open", contract.ErrNotFound)
	}
	_, err = c.client.w.Write(append(line, '\n'))
	return err
}

// sendSessions tells the client about the user's ready sessions when they
// changed since the last time. An empty list goes out as a message without
// sessions.
func (c *conn) sendSessions(list []control.Session) {
	c.client.mu.Lock()
	same := c.client.w != nil && c.client.sessions != nil && slices.Equal(c.client.sessions, list)
	c.client.mu.Unlock()
	if same {
		return
	}
	if err := c.send(control.Message{Type: control.TypeSessions, Sessions: list}); err != nil {
		return
	}
	c.client.mu.Lock()
	c.client.sessions = append([]control.Session{}, list...)
	c.client.mu.Unlock()
}

func (c *conn) info() control.Computer {
	c.client.mu.Lock()
	defer c.client.mu.Unlock()
	pinned := c.client.state.Pinned
	if pinned == nil {
		pinned = c.client.state.Published
	}
	return control.Computer{
		ID: c.computer, Hostname: c.hostname, OS: c.client.hello.OS, Arch: c.client.hello.Arch, Version: c.client.hello.Version,
		ClientIP: c.remote, Since: c.since,
		Listening: nonNil(c.client.state.Listening), Published: nonNil(c.client.state.Published), ADB: nonNil(c.client.state.ADB),
		Mode: cmp.Or(c.client.state.Mode, control.PublishManual), Pinned: nonNil(pinned),
	}
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

// newest is the latest connection of each of the user's computers; a client
// that reconnects may briefly have two.
func (g *Gateway) newest(user string) map[string]*conn {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := map[string]*conn{}
	for c := range g.conns {
		if c.user != user {
			continue
		}
		if prev, ok := out[c.computer]; !ok || c.since.After(prev.since) {
			out[c.computer] = c
		}
	}
	return out
}

func (g *Gateway) Computers(_ context.Context, user string) ([]control.Computer, error) {
	list := []control.Computer{}
	for _, c := range g.newest(user) {
		list = append(list, c.info())
	}
	slices.SortFunc(list, func(a, b control.Computer) int { return a.Since.Compare(b.Since) })
	return list, nil
}

// SetPublished asks the client to publish exactly ports. An empty list goes
// out as a publish message without ports.
func (g *Gateway) SetPublished(_ context.Context, user, computer string, ports []int) error {
	c, ok := g.newest(user)[computer]
	if !ok {
		return fmt.Errorf("%w: computer %q", contract.ErrNotFound, computer)
	}
	c.log.Info("published ports changed in the portal", "ports", ports)
	return c.send(control.Message{Type: control.TypePublish, Publish: ports})
}
