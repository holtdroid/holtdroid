package contract_test

import (
	"context"
	"io"
	"net"
	"testing"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func tcpPair(t *testing.T) (*net.TCPConn, *net.TCPConn) {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	accepted := make(chan net.Conn, 1)
	go func() {
		c, _ := ln.Accept()
		accepted <- c
	}()
	var d net.Dialer
	c, err := d.DialContext(context.Background(), "tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	s := <-accepted
	t.Cleanup(func() { c.Close(); s.Close() })
	return c.(*net.TCPConn), s.(*net.TCPConn)
}

func TestSpliceKeepsTheReplyAfterAHalfClose(t *testing.T) {
	client, proxyIn := tcpPair(t)
	proxyOut, server := tcpPair(t)
	var bytes int
	done := make(chan struct{})
	go func() {
		contract.Splice(proxyIn, proxyOut, func(n int) { bytes += n })
		close(done)
	}()
	go func() {
		req, _ := io.ReadAll(server)
		_, _ = server.Write(append([]byte("re: "), req...))
		server.Close()
	}()

	_, _ = client.Write([]byte("ping"))
	_ = client.CloseWrite()
	reply, err := io.ReadAll(client)
	if err != nil || string(reply) != "re: ping" {
		t.Fatalf("reply %q, %v", reply, err)
	}
	<-done
	if bytes != len("ping")+len("re: ping") {
		t.Fatalf("counted %d bytes", bytes)
	}
}
