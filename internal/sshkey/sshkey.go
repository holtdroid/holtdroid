package sshkey

import (
	"crypto/rsa"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/ssh"
)

const MinRSABits = 2048

var ErrInvalid = errors.New("invalid SSH public key")

type Key struct {
	Public      ssh.PublicKey
	Comment     string
	Bits        int
	Fingerprint string
}

// AuthorizedKey is the normalized authorized_keys line without a comment.
func (k Key) AuthorizedKey() string {
	return strings.TrimSpace(string(ssh.MarshalAuthorizedKey(k.Public)))
}

var allowed = map[string]bool{
	ssh.KeyAlgoED25519:    true,
	ssh.KeyAlgoSKED25519:  true,
	ssh.KeyAlgoECDSA256:   true,
	ssh.KeyAlgoECDSA384:   true,
	ssh.KeyAlgoECDSA521:   true,
	ssh.KeyAlgoSKECDSA256: true,
	ssh.KeyAlgoRSA:        true,
}

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrInvalid}, args...)...)
}

// Parse accepts a single OpenSSH public key line ("type base64 [comment]").
func Parse(line string) (Key, error) {
	line = strings.TrimSpace(line)
	if strings.Contains(line, "PRIVATE KEY") {
		return Key{}, invalid("this is a private key, use the .pub file")
	}
	if line == "" {
		return Key{}, invalid("empty")
	}
	pub, comment, options, rest, err := ssh.ParseAuthorizedKey([]byte(line))
	if err != nil {
		return Key{}, invalid("not an OpenSSH public key")
	}
	if len(options) > 0 {
		return Key{}, invalid("authorized_keys options are not allowed")
	}
	if strings.TrimSpace(string(rest)) != "" {
		return Key{}, invalid("one key per entry")
	}
	if !allowed[pub.Type()] {
		return Key{}, invalid("unsupported key type %s", pub.Type())
	}
	k := Key{Public: pub, Comment: comment, Fingerprint: ssh.FingerprintSHA256(pub)}
	if cpk, ok := pub.(ssh.CryptoPublicKey); ok {
		if rk, ok := cpk.CryptoPublicKey().(*rsa.PublicKey); ok {
			k.Bits = rk.N.BitLen()
			if k.Bits < MinRSABits {
				return Key{}, invalid("RSA keys need at least %d bits, this one has %d", MinRSABits, k.Bits)
			}
		}
	}
	return k, nil
}
