package fake

import (
	"context"

	"github.com/kriakiku/holtdroid/internal/contract"
)

func (d *device) WatchScreen(ctx context.Context, send func(contract.Screen) error) error {
	updates, cancel := d.subscribe()
	defer cancel()
	var last *contract.Screen
	for {
		d.mu.Lock()
		cur := d.screen
		d.mu.Unlock()
		if last == nil || *last != cur {
			if err := send(cur); err != nil {
				return err
			}
			last = &cur
		}
		select {
		case <-ctx.Done():
			return nil
		case <-updates:
		}
	}
}
