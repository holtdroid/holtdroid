package fake

import (
	"context"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const vibrationInterval = 45 * time.Second

// WatchVibrations buzzes like a notification from the app now and then.
func (d *device) WatchVibrations(ctx context.Context, send func(contract.Vibration) error) error {
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(vibrationInterval):
		}
		if s := d.session(); s.State == contract.StateReady {
			if err := send(contract.Vibration{Usage: "NOTIFICATION", Package: s.Package, DurationMS: 400}); err != nil {
				return err
			}
		}
	}
}
