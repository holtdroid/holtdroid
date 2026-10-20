package sshkey

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"strings"

	"golang.org/x/crypto/ssh"

	"github.com/holtdroid/holtdroid/internal/secrets"
)

// LoadPrivate reads the PEM private key ref points to and also returns the
// PEM itself, for deriving other keys from it. Without a ref it makes a
// throwaway ed25519 key and temporary is true.
func LoadPrivate(ctx context.Context, reg *secrets.Registry, ref secrets.Ref) (signer ssh.Signer, secret []byte, temporary bool, err error) {
	if ref.IsZero() {
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, nil, false, err
		}
		signer, err := ssh.NewSignerFromKey(key)
		return signer, key.Seed(), true, err
	}
	pem, err := reg.Resolve(ctx, ref)
	if err != nil {
		return nil, nil, false, err
	}
	signer, err = ssh.ParsePrivateKey([]byte(pem))
	if err != nil {
		return nil, nil, false, errors.New("not a PEM private key without a passphrase")
	}
	return signer, []byte(pem), false, nil
}

// Authorized is key as an authorized_keys line without a comment.
func Authorized(key ssh.PublicKey) string {
	return strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key)))
}
