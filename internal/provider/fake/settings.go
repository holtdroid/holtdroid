package fake

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"slices"

	"github.com/kriakiku/holtdroid/internal/contract"
)

func defaultSettings() contract.DeviceState {
	return contract.DeviceState{
		WiFi:               true,
		MobileData:         true,
		BatteryLevel:       65,
		FontScale:          1,
		Density:            320,
		DefaultDensity:     320,
		NetworkProfile:     contract.NetworkFull,
		TimeZone:           "UTC",
		Locale:             "en-US",
		Locales:            []string{"en-US"},
		CanFakeGeo:         true,
		CanSimulateBattery: true,
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
	case contract.DeviceVolumeUp, contract.DeviceVolumeDown, contract.DeviceMute, contract.DeviceScreenOff, contract.DeviceLock, contract.DeviceUnlock,
		contract.DeviceBack, contract.DeviceHome, contract.DeviceNotifications, contract.DeviceQuickSettings:
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
