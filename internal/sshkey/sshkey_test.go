package sshkey

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

func authorizedKey(t *testing.T, key any, comment string) string {
	t.Helper()
	pub, err := ssh.NewPublicKey(key)
	if err != nil {
		t.Fatal(err)
	}
	line := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(pub)))
	if comment != "" {
		line += " " + comment
	}
	return line
}

func TestParse(t *testing.T) {
	edPub, _, _ := ed25519.GenerateKey(rand.Reader)
	ec, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	rsaSmall, _ := rsa.GenerateKey(rand.Reader, 1024)
	rsaOK, _ := rsa.GenerateKey(rand.Reader, 2048)
	ed := authorizedKey(t, edPub, "me@laptop")

	tests := []struct {
		name    string
		line    string
		bits    int
		comment string
		err     string
	}{
		{name: "ed25519", line: "  " + ed + "\n", comment: "me@laptop"},
		{name: "ecdsa", line: authorizedKey(t, &ec.PublicKey, "")},
		{name: "rsa 2048", line: authorizedKey(t, &rsaOK.PublicKey, "ci"), bits: 2048, comment: "ci"},
		{name: "rsa 1024", line: authorizedKey(t, &rsaSmall.PublicKey, ""), err: "at least 2048 bits"},
		{name: "empty", line: "  ", err: "empty"},
		{name: "garbage", line: "hello world", err: "not an OpenSSH public key"},
		{name: "private key", line: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn...", err: "private key"},
		{name: "options", line: `no-pty ` + ed, err: "options"},
		{name: "two keys", line: ed + "\n" + ed, err: "one key per entry"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			k, err := Parse(tt.line)
			if tt.err != "" {
				if err == nil || !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), tt.err) {
					t.Fatalf("err = %v, want %q", err, tt.err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if k.Bits != tt.bits || k.Comment != tt.comment || !strings.HasPrefix(k.Fingerprint, "SHA256:") {
				t.Fatalf("got %+v", k)
			}
			if strings.Count(k.AuthorizedKey(), " ") != 1 {
				t.Fatalf("authorized key not normalized: %q", k.AuthorizedKey())
			}
		})
	}
}
