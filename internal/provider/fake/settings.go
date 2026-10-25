package fake

import (
	"bytes"
	"cmp"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"slices"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/netem"
)

func defaultSettings() contract.DeviceState {
	return contract.DeviceState{
		WiFi:               true,
		MobileData:         true,
		BatteryLevel:       65,
		FontScale:          1,
		Density:            320,
		DefaultDensity:     320,
		Volume:             5,
		VolumeMax:          15,
		NetworkProfile:     contract.NetworkFull,
		NetworkProfiles:    netem.Catalog(),
		TimeZone:           "UTC",
		Locale:             "en-US",
		Locales:            []string{"en-US"},
		CanFakeGeo:         true,
		CanSimulateBattery: true,
		LanguageScope:      contract.LanguageSystem,
		AutoTime:           true,
	}
}

func (d *device) Device(context.Context) (contract.DeviceState, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	s := d.settings
	s.Locales = slices.Clone(s.Locales)
	return s, nil
}

func (d *device) UpdateDevice(_ context.Context, in contract.DeviceSettings) (contract.DeviceState, error) {
	if p := in.NetworkProfile; p != nil {
		if _, ok := netem.Find(*p); !ok {
			return contract.DeviceState{}, fmt.Errorf("%w: unknown network profile %q", contract.ErrInvalid, *p)
		}
	}
	d.update(func() {
		s := &d.settings
		set(&s.AirplaneMode, in.AirplaneMode)
		set(&s.WiFi, in.WiFi)
		set(&s.MobileData, in.MobileData)
		set(&s.BatteryLevel, in.BatteryLevel)
		set(&s.Charging, in.Charging)
		if in.BatterySaver != nil && *in.BatterySaver && in.Charging == nil {
			s.Charging = false
		}
		set(&s.BatterySaver, in.BatterySaver)
		set(&s.DarkMode, in.DarkMode)
		set(&s.FontScale, in.FontScale)
		set(&s.Density, in.Density)
		if s.Density == 0 {
			s.Density = s.DefaultDensity
		}
		set(&s.Rotation, in.Rotation)
		switch {
		case in.Muted != nil && *in.Muted:
			d.unmuteTo, s.Volume, s.Muted = cmp.Or(s.Volume, d.unmuteTo), 0, true
		case in.Volume != nil:
			s.Volume = min(*in.Volume, s.VolumeMax)
			s.Muted = s.Volume == 0
		case in.Muted != nil:
			s.Volume, s.Muted = cmp.Or(d.unmuteTo, 5), false
		}
		set(&s.NetworkProfile, in.NetworkProfile)
		set(&s.TimeZone, in.TimeZone)
		if len(in.Locales) > 0 {
			s.Locales = slices.Clone(in.Locales)
			s.Locale = s.Locales[0]
		}
		switch {
		case in.Geo != nil:
			s.Geo = &contract.GeoPoint{Latitude: in.Geo.Latitude, Longitude: in.Geo.Longitude}
		case in.ResetGeo:
			s.Geo = nil
		}
		set(&s.AutoTime, in.AutoTime)
		switch {
		case in.AutoTime != nil && *in.AutoTime:
			s.TimeOffset = 0
		case in.TimeOffset != nil:
			s.TimeOffset, s.AutoTime = *in.TimeOffset, false
		}
	})
	return d.Device(context.Background())
}

func (d *device) DeviceAction(_ context.Context, action contract.DeviceAction) error {
	switch action {
	case contract.DeviceRotateLeft:
		d.update(func() { d.settings.Rotation = (d.settings.Rotation + 1) % 4 })
	case contract.DeviceRotateRight:
		d.update(func() { d.settings.Rotation = (d.settings.Rotation + 3) % 4 })
	case contract.DeviceRecents:
		// Stands in for swiping the app away, so the closed state can be tried out.
		d.update(func() { d.appClosed = true })
	case contract.DeviceScreenOff:
		d.update(func() { d.screen.On = false })
	case contract.DeviceLock:
		d.update(func() { d.screen = contract.Screen{On: true, Locked: true} })
	case contract.DeviceUnlock:
		d.update(func() { d.screen = contract.Screen{On: true} })
	case contract.DeviceVolumeUp:
		d.update(func() { d.settings.Volume, d.settings.Muted = min(d.settings.Volume+1, d.settings.VolumeMax), false })
	case contract.DeviceVolumeDown:
		d.update(func() {
			d.settings.Volume = max(d.settings.Volume-1, 0)
			d.settings.Muted = d.settings.Volume == 0
		})
	case contract.DeviceMute:
		d.update(func() {
			s := &d.settings
			if s.Muted {
				s.Volume, s.Muted = cmp.Or(d.unmuteTo, 5), false
			} else {
				d.unmuteTo, s.Volume, s.Muted = s.Volume, 0, true
			}
		})
	case contract.DeviceBack, contract.DeviceHome, contract.DeviceNotifications, contract.DeviceQuickSettings:
	default:
		return fmt.Errorf("%w: unknown action %q", contract.ErrInvalid, action)
	}
	return nil
}

func (d *device) Screenshot(context.Context) ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, 360, 780))
	for i := range img.Pix {
		if i%4 == 3 {
			img.Pix[i] = 0xff
		}
	}
	green := color.RGBA{0x3d, 0xdc, 0x84, 0xff}
	for y := 380; y < 400; y++ {
		for x := 170; x < 190; x++ {
			img.Set(x, y, green)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func set[T any](dst *T, v *T) {
	if v != nil {
		*dst = *v
	}
}
