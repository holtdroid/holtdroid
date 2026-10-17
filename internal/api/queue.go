package api

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/kriakiku/holtdroid/internal/contract"
)

// launchQueue lines up launches per provider, so that a freed slot goes to
// whoever has waited longest. It lives in one replica's memory only.
type launchQueue struct {
	poll  time.Duration
	mu    sync.Mutex
	lines map[string][]chan struct{}
}

func newLaunchQueue(poll time.Duration) *launchQueue {
	return &launchQueue{poll: poll, lines: map[string][]chan struct{}{}}
}

func (q *launchQueue) join(provider string) (front <-chan struct{}, leave func()) {
	ch := make(chan struct{})
	q.mu.Lock()
	if len(q.lines[provider]) == 0 {
		close(ch)
	}
	q.lines[provider] = append(q.lines[provider], ch)
	q.mu.Unlock()
	return ch, func() {
		q.mu.Lock()
		defer q.mu.Unlock()
		line := q.lines[provider]
		i := slices.Index(line, ch)
		if i < 0 {
			return
		}
		line = slices.Delete(line, i, i+1)
		if i == 0 && len(line) > 0 {
			close(line[0])
		}
		if len(line) == 0 {
			delete(q.lines, provider)
		} else {
			q.lines[provider] = line
		}
	}
}

// acquire waits for the caller's turn and a free slot. Without wait it fails
// with ErrNoCapacity instead of waiting. The returned release must be called
// once the session is created, or right away on error.
func (q *launchQueue) acquire(ctx context.Context, provider string, p contract.Provider, wait bool) (release func(), err error) {
	front, leave := q.join(provider)
	defer func() {
		if err != nil {
			leave()
		}
	}()
	select {
	case <-front:
	default:
		if !wait {
			return nil, contract.ErrNoCapacity
		}
		select {
		case <-front:
		case <-ctx.Done():
			return nil, fmt.Errorf("left the queue: %w", ctx.Err())
		}
	}
	for {
		c, cerr := p.Capacity(ctx)
		if cerr != nil {
			return nil, cerr
		}
		if c.Free() > 0 {
			return leave, nil
		}
		if !wait {
			return nil, contract.ErrNoCapacity
		}
		select {
		case <-time.After(q.poll):
		case <-ctx.Done():
			return nil, fmt.Errorf("left the queue: %w", ctx.Err())
		}
	}
}
