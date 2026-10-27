package conns

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/encoding/protowire"

	"github.com/holtdroid/holtdroid/internal/contract"
)

// subscribeMethod streams sing-box's connection events (daemon/started_service.proto,
// sing-box 1.14): the open and the last 1000 closed connections first, then
// each one that opens or closes, as it happens, and traffic every interval.
const subscribeMethod = "/daemon.StartedService/SubscribeConnections"

const (
	eventNew    = 0
	eventUpdate = 1
	eventClosed = 2
)

// Own reports whether a connection is the agent's or the sidecar's rather
// than the device's, by its inbound tag and outbound chain.
type Own func(inbound string, chain []string) bool

// Follow streams addr's events into t until ctx ends, connecting again
// after a failure.
func (t *Tracker) Follow(ctx context.Context, addr string, own Own) {
	conn, err := grpcClient(addr)
	if err != nil {
		t.log.Error("connections: sing-box api", "err", err)
		return
	}
	defer conn.Close()
	failing := false
	for ctx.Err() == nil {
		err := t.follow(ctx, conn, own)
		if ctx.Err() != nil {
			return
		}
		if !failing {
			t.log.Warn("connections: sing-box api", "err", err)
		}
		failing = true
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
		}
	}
}

func grpcClient(addr string) (*grpc.ClientConn, error) {
	return grpc.NewClient("passthrough:///"+addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
}

func (t *Tracker) follow(ctx context.Context, conn *grpc.ClientConn, own Own) error {
	stream, err := conn.NewStream(ctx, &grpc.StreamDesc{ServerStreams: true}, subscribeMethod, grpc.ForceCodec(rawCodec{}), grpc.WaitForReady(true))
	if err != nil {
		return err
	}
	req := protowire.AppendTag(nil, 1, protowire.VarintType)
	req = protowire.AppendVarint(req, uint64(time.Second))
	if err := stream.SendMsg(&req); err != nil {
		return err
	}
	if err := stream.CloseSend(); err != nil {
		return err
	}
	for {
		var msg []byte
		if err := stream.RecvMsg(&msg); err != nil {
			return err
		}
		events, err := parseEvents(msg)
		if err != nil {
			return err
		}
		t.apply(events, own)
	}
}

func (t *Tracker) apply(events []event, own Own) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, e := range events {
		c, ok := e.conn.contract()
		if e.hasConn && (!ok || own(e.conn.inbound, e.conn.chain)) {
			continue
		}
		switch e.typ {
		case eventNew:
			if e.conn.closedAt != 0 {
				t.closeLocked(e.id, time.UnixMilli(e.conn.closedAt), &c)
				continue
			}
			t.openLocked(c)
		case eventUpdate:
			if tr, open := t.open[e.id]; open {
				tr.c.Upload += e.up
				tr.c.Download += e.down
				if now := t.now(); now.Sub(tr.sent) >= updateEvery && (e.up > 0 || e.down > 0) {
					tr.sent = now
					t.publish(tr.c)
				}
			}
		case eventClosed:
			var final *contract.Connection
			if e.hasConn {
				final = &c
			}
			t.closeLocked(e.id, time.UnixMilli(e.closedAt), final)
		}
	}
}

type event struct {
	typ      uint64
	id       string
	conn     protoConn
	hasConn  bool
	up, down int64
	closedAt int64
}

type protoConn struct {
	id, inbound, network, destination, domain, outbound string
	chain                                               []string
	createdAt, closedAt, upload, download               int64
}

// contract turns it into a Connection: a destination that is a name
// (a proxy asked for one) leaves the address empty. False for a loopback or
// unreadable destination.
func (p protoConn) contract() (contract.Connection, bool) {
	c := contract.Connection{
		ID: p.id, Start: time.UnixMilli(p.createdAt), Network: p.network, Host: p.domain,
		Outbound: firstOf(p.chain, p.outbound), Upload: p.upload, Download: p.download,
	}
	host, port, err := net.SplitHostPort(p.destination)
	if err != nil {
		return c, false
	}
	c.Port, _ = strconv.Atoi(port)
	addr, err := netip.ParseAddr(host)
	if err != nil {
		c.Host = cmp.Or(c.Host, host)
		return c, c.Host != ""
	}
	c.Address = addr.Unmap().String()
	return c, !addr.IsLoopback()
}

// firstOf is the outbound a connection left through; the chain runs from
// the last hop back to the selector.
func firstOf(chain []string, fallback string) string {
	if len(chain) > 0 {
		return chain[0]
	}
	return fallback
}

func parseEvents(b []byte) ([]event, error) {
	var out []event
	err := fields(b, func(num protowire.Number, typ protowire.Type, v []byte, n uint64) error {
		if num != 1 || typ != protowire.BytesType {
			return nil
		}
		e, err := parseEvent(v)
		out = append(out, e)
		return err
	})
	return out, err
}

func parseEvent(b []byte) (event, error) {
	var e event
	err := fields(b, func(num protowire.Number, typ protowire.Type, v []byte, n uint64) error {
		switch num {
		case 1:
			e.typ = n
		case 2:
			e.id = string(v)
		case 3:
			e.hasConn = true
			c, err := parseConn(v)
			e.conn = c
			return err
		case 4:
			e.up = int64(n)
		case 5:
			e.down = int64(n)
		case 6:
			e.closedAt = int64(n)
		}
		return nil
	})
	return e, err
}

func parseConn(b []byte) (protoConn, error) {
	var c protoConn
	err := fields(b, func(num protowire.Number, typ protowire.Type, v []byte, n uint64) error {
		switch num {
		case 1:
			c.id = string(v)
		case 2:
			c.inbound = string(v)
		case 5:
			c.network = string(v)
		case 7:
			c.destination = string(v)
		case 8:
			c.domain = string(v)
		case 12:
			c.createdAt = int64(n)
		case 13:
			c.closedAt = int64(n)
		case 16:
			c.upload = int64(n)
		case 17:
			c.download = int64(n)
		case 19:
			c.outbound = string(v)
		case 21:
			c.chain = append(c.chain, string(v))
		}
		return nil
	})
	return c, err
}

// fields walks a protobuf message: v is a length-delimited field's bytes,
// n a varint's value.
func fields(b []byte, f func(num protowire.Number, typ protowire.Type, v []byte, n uint64) error) error {
	for len(b) > 0 {
		num, typ, l := protowire.ConsumeTag(b)
		if l < 0 {
			return protowire.ParseError(l)
		}
		b = b[l:]
		var v []byte
		var n uint64
		switch typ {
		case protowire.VarintType:
			n, l = protowire.ConsumeVarint(b)
		case protowire.BytesType:
			v, l = protowire.ConsumeBytes(b)
		default:
			l = protowire.ConsumeFieldValue(num, typ, b)
		}
		if l < 0 {
			return protowire.ParseError(l)
		}
		b = b[l:]
		if err := f(num, typ, v, n); err != nil {
			return err
		}
	}
	return nil
}

type rawCodec struct{}

func (rawCodec) Name() string { return "proto" }

func (rawCodec) Marshal(v any) ([]byte, error) {
	b, ok := v.(*[]byte)
	if !ok {
		return nil, fmt.Errorf("raw codec: marshal %T", v)
	}
	return *b, nil
}

func (rawCodec) Unmarshal(data []byte, v any) error {
	b, ok := v.(*[]byte)
	if !ok {
		return errors.New("raw codec: unmarshal into a non-byte slice")
	}
	*b = append((*b)[:0], data...)
	return nil
}
