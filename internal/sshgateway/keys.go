package sshgateway

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/sshkey"
)

type Identity struct {
	User   string
	Groups []string
	Admin  bool
}

type userKeys struct {
	id           Identity
	fingerprints []string
	expires      time.Time
}

// Keys holds the public keys pushed by the api, only in memory. Each user's
// set expires after ttl unless it is pushed again.
type Keys struct {
	mu    sync.Mutex
	ttl   time.Duration
	now   func() time.Time
	users map[string]*userKeys
	owner map[string]string
}

func NewKeys(ttl time.Duration, now func() time.Time) *Keys {
	if now == nil {
		now = time.Now
	}
	return &Keys{ttl: ttl, now: now, users: map[string]*userKeys{}, owner: map[string]string{}}
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
		id:           Identity{User: user, Groups: slices.Clone(in.Groups), Admin: in.Admin},
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
