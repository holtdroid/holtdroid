package sshgateway

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/kriakiku/holtdroid/internal/contract"
)

func newKey(t *testing.T) (string, string) {
	t.Helper()
	raw, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := ssh.NewPublicKey(raw)
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(ssh.MarshalAuthorizedKey(pub))), ssh.FingerprintSHA256(pub)
}

func TestKeysOverContract(t *testing.T) {
	var now atomic.Int64
	now.Store(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Unix())
	keys := NewKeys(time.Hour, func() time.Time { return time.Unix(now.Load(), 0) })
	mux := http.NewServeMux()
	contract.RegisterSSHGateway(contract.NewAPI(mux, "test"), keys)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	c := contract.NewSSHGatewayClient(srv.URL, nil)
	ctx := context.Background()

	a, aFP := newKey(t)
	b, bFP := newKey(t)
	other, otherFP := newKey(t)

	if err := c.SetUserKeys(ctx, "alice@example.com", contract.UserKeys{Groups: []string{"dev"}, Keys: []string{a, b}}); err != nil {
		t.Fatal(err)
	}
	if id, ok := keys.Lookup(bFP); !ok || id.User != "alice@example.com" || !slices.Equal(id.Groups, []string{"dev"}) {
		t.Fatalf("lookup b = %+v, %v", id, ok)
	}

	err := c.SetUserKeys(ctx, "bob", contract.UserKeys{Keys: []string{other, b}})
	if claimed, ok := errors.AsType[*contract.KeysClaimedError](err); !ok || !slices.Equal(claimed.Keys, []int{1}) {
		t.Fatalf("claimed err = %v", err)
	}
	if _, ok := keys.Lookup(otherFP); ok {
		t.Fatal("rejected update must not register any key")
	}

	if err := c.SetUserKeys(ctx, "bob", contract.UserKeys{Keys: []string{"nope"}}); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("invalid key err = %v", err)
	}

	if err := c.SetUserKeys(ctx, "alice@example.com", contract.UserKeys{Keys: []string{a}}); err != nil {
		t.Fatal(err)
	}
	if _, ok := keys.Lookup(bFP); ok {
		t.Fatal("removed key still registered")
	}
	if err := c.SetUserKeys(ctx, "bob", contract.UserKeys{Keys: []string{b}}); err != nil {
		t.Fatalf("freed key: %v", err)
	}

	now.Add(int64(time.Hour / time.Second))
	if _, ok := keys.Lookup(aFP); ok {
		t.Fatal("key outlived its TTL")
	}
	if err := c.SetUserKeys(ctx, "carol", contract.UserKeys{Keys: []string{a}}); err != nil {
		t.Fatalf("expired key: %v", err)
	}

	if err := c.SetUserKeys(ctx, "carol", contract.UserKeys{}); err != nil {
		t.Fatal(err)
	}
	if _, ok := keys.Lookup(aFP); ok {
		t.Fatal("empty set must drop the user's keys")
	}
}
