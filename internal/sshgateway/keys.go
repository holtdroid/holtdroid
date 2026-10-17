package sshgateway

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/sshkey"
)

type Identity struct {
	User   string
	Handle string
	Groups []string
	Admin  bool
}

type userKeys struct {
	id           Identity
	fingerprints []string
	expires      time.Time
}

// Keys holds the public keys pushed by the api, only in memory. Each user's
// set expires after ttl unless it is pushed again. It also holds the key
// requests of connections waiting for their key to be added.
type Keys struct {
	mu       sync.Mutex
	ttl      time.Duration
	now      func() time.Time
	users    map[string]*userKeys
	owner    map[string]string
	requests map[string]contract.KeyRequest
}

const maxKeyRequests = 64

var errTooManyRequests = errors.New("too many connections are waiting for a key to be added")

func NewKeys(ttl time.Duration, now func() time.Time) *Keys {
	if now == nil {
		now = time.Now
	}
	return &Keys{ttl: ttl, now: now, users: map[string]*userKeys{}, owner: map[string]string{}, requests: map[string]contract.KeyRequest{}}
}

func (k *Keys) KeyRequest(_ context.Context, code string) (contract.KeyRequest, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	r, ok := k.requests[code]
	if !ok {
		return contract.KeyRequest{}, fmt.Errorf("%w: key request", contract.ErrNotFound)
	}
	return r, nil
}

func (k *Keys) addRequest(r contract.KeyRequest) (string, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if len(k.requests) >= maxKeyRequests {
		return "", errTooManyRequests
	}
	b := make([]byte, 10)
	_, _ = rand.Read(b)
	code := strings.ToLower(base32.StdEncoding.EncodeToString(b))
	k.requests[code] = r
	return code, nil
}

func (k *Keys) dropRequest(code string) {
	k.mu.Lock()
	defer k.mu.Unlock()
	delete(k.requests, code)
}

func (k *Keys) SetUserKeys(_ context.Context, user string, in contract.UserKeys) error {
	fingerprints := make([]string, 0, len(in.Keys))
	for i, line := range in.Keys {
		key, err := sshkey.Parse(line)
		if err != nil {
			return fmt.Errorf("%w: keys[%d]: %w", contract.ErrInvalid, i, err)
		}
		fingerprints = append(fingerprints, key.Fingerprint)
	}

	k.mu.Lock()
	defer k.mu.Unlock()
	now := k.now()
	k.expire(now)

	claimed := &contract.KeysClaimedError{}
	for i, fp := range fingerprints {
		if owner, ok := k.owner[fp]; ok && owner != user {
			claimed.Keys = append(claimed.Keys, i)
		}
	}
	if len(claimed.Keys) > 0 {
		return claimed
	}

	k.remove(user)
	if len(fingerprints) == 0 {
		return nil
	}
	k.users[user] = &userKeys{
		id:           Identity{User: user, Handle: in.Handle, Groups: slices.Clone(in.Groups), Admin: in.Admin},
		fingerprints: fingerprints,
		expires:      now.Add(k.ttl),
	}
	for _, fp := range fingerprints {
		k.owner[fp] = user
	}
	return nil
}

// Lookup finds who registered the key with this SHA256 fingerprint.
func (k *Keys) Lookup(fingerprint string) (Identity, bool) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.expire(k.now())
	user, ok := k.owner[fingerprint]
	if !ok {
		return Identity{}, false
	}
	return k.users[user].id, true
}

// HandleKnown tells whether a user with keys here has this handle.
func (k *Keys) HandleKnown(handle string) bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.expire(k.now())
	for _, uk := range k.users {
		if uk.id.Handle == handle {
			return true
		}
	}
	return false
}

func (k *Keys) expire(now time.Time) {
	for user, uk := range k.users {
		if !now.Before(uk.expires) {
			k.remove(user)
		}
	}
}

func (k *Keys) remove(user string) {
	uk, ok := k.users[user]
	if !ok {
		return
	}
	for _, fp := range uk.fingerprints {
		delete(k.owner, fp)
	}
	delete(k.users, user)
}
