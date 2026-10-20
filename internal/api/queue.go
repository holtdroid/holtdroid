package api

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

// launchQueue lines up launches per target (any device, a provider, or one
// of its slots), so that a freed slot goes to whoever has waited longest. It lives in one replica's memory only.
type launchQueue struct {
	poll  time.Duration
	mu    sync.Mutex
	lines map[string][]chan struct{}
}

func newLaunchQueue(poll time.Duration) *launchQueue {
	return &launchQueue{poll: poll, lines: map[string][]chan struct{}{}}
}

func (q *launchQueue) join(line string) (front <-chan struct{}, leave func()) {
	ch := make(chan struct{})
	q.mu.Lock()
	if len(q.lines[line]) == 0 {
		close(ch)
	}
	q.lines[line] = append(q.lines[line], ch)
	q.mu.Unlock()
	return ch, func() {
		q.mu.Lock()
		defer q.mu.Unlock()
		waiting := q.lines[line]
		i := slices.Index(waiting, ch)
		if i < 0 {
			return
		}
		waiting = slices.Delete(waiting, i, i+1)
		if i == 0 && len(waiting) > 0 {
			close(waiting[0])
		}
		if len(waiting) == 0 {
			delete(q.lines, line)
		} else {
			q.lines[line] = waiting
		}
	}
}

// run waits for the caller's turn in line, then calls try until it stops
// failing with ErrNoCapacity, keeping the place in line in between. Without
// wait it fails with ErrNoCapacity instead of waiting.
func (q *launchQueue) run(ctx context.Context, line string, wait bool, try func() error) error {
	front, leave := q.join(line)
	defer leave()
	select {
	case <-front:
	default:
		if !wait {
			return contract.ErrNoCapacity
		}
		select {
		case <-front:
		case <-ctx.Done():
			return fmt.Errorf("left the queue: %w", ctx.Err())
		}
	}
	for {
		err := try()
		if !wait || !errors.Is(err, contract.ErrNoCapacity) {
			return err
		}
		select {
		case <-time.After(q.poll):
		case <-ctx.Done():
			return fmt.Errorf("left the queue: %w", ctx.Err())
		}
	}
}
