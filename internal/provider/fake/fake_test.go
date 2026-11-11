package fake

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func TestCreatePicksDevice(t *testing.T) {
	for _, tc := range []struct {
		name, screen, android string
		wantScreen, wantAPI   string
		invalid               bool
	}{
		{name: "default", wantScreen: "classic", wantAPI: "15"},
		{name: "valid", screen: "classic", android: "13", wantScreen: "classic", wantAPI: "13"},
		{name: "unknown screen", screen: "foldable", invalid: true},
		{name: "unknown version", android: "99", invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := DefaultConfig()
			cfg.StepDelay = time.Hour
			p := New(cfg)
			s, err := p.Create(context.Background(), contract.CreateSession{Package: "com.example", Screen: tc.screen, Android: tc.android})
			if tc.invalid {
				if !errors.Is(err, contract.ErrInvalid) {
					t.Fatalf("err = %v, want ErrInvalid", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = p.Delete(context.Background(), s.ID) })
			c := s.Capabilities
			if c == nil || c.Screen == nil || c.Screen.ID != tc.wantScreen || c.Android != tc.wantAPI {
				t.Fatalf("capabilities = %+v", c)
			}
			st, err := p.sessions[s.ID].Device(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if st.ScreenWidth != c.Screen.Width || st.ScreenHeight != c.Screen.Height || st.Density != c.Screen.DPI || st.DefaultDensity != c.Screen.DPI {
				t.Fatalf("device state %dx%d @%d (default %d), want the screen %+v", st.ScreenWidth, st.ScreenHeight, st.Density, st.DefaultDensity, *c.Screen)
			}
		})
	}
}
