package emulator

import (
	"cmp"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/holtdroid/holtdroid/internal/contract"
)

// DefaultScreens are the displays of popular budget and mid-range phones
// of 2023–2024, by resolution and density class; the first is the default
// and the cheapest to stream.
func DefaultScreens() []contract.Display {
	return []contract.Display{
		{ID: "hd", Label: "HD+", Like: "Galaxy A05, Redmi 13C", Width: 720, Height: 1600, DPI: 280, Cutout: "tall"},
		{ID: "fhd-samsung", Label: "FHD+ 19.5:9", Like: "Galaxy A15, A25, A35", Width: 1080, Height: 2340, DPI: 420, Cutout: "tall"},
		{ID: "fhd", Label: "FHD+ 20:9", Like: "Pixel 6a–8a, Moto G54, Realme C67", Width: 1080, Height: 2400, DPI: 420, Cutout: "hole"},
		{ID: "fhd-tall", Label: "FHD+ tall", Like: "Infinix Hot 40", Width: 1080, Height: 2460, DPI: 420, Cutout: "hole"},
		{ID: "1.5k", Label: "1.5K", Like: "Redmi Note 13 Pro, Poco X6", Width: 1220, Height: 2712, DPI: 480, Cutout: "hole"},
		{ID: "tablet", Label: "Tablet", Like: "Galaxy Tab A9+", Width: 1200, Height: 1920, DPI: 240, Cutout: "none"},
	}
}

// model names a screen for the session's capabilities.
func model(d contract.Display) string {
	m := fmt.Sprintf("%s %d×%d", d.Label, d.Width, d.Height)
	if d.Like != "" {
		m += " · " + d.Like
	}
	return m
}

func validateScreens(screens []contract.Display) error {
	if len(screens) == 0 {
		return errors.New("redroid.screens: at least one screen is required")
	}
	seen := map[string]bool{}
	for _, s := range screens {
		switch {
		case s.ID == "" || seen[s.ID]:
			return fmt.Errorf("redroid.screens: ids must be unique and not empty (%q)", s.ID)
		case s.Width <= 0 || s.Height <= 0 || s.DPI <= 0:
			return fmt.Errorf("redroid.screens[%s]: width, height and dpi must be positive", s.ID)
		case s.Cutout != "" && !slices.Contains(contract.Cutouts, s.Cutout):
			return fmt.Errorf("redroid.screens[%s]: cutout must be one of %s", s.ID, strings.Join(contract.Cutouts, ", "))
		}
		seen[s.ID] = true
	}
	return nil
}

func (r Redroid) screen(id string) (contract.Display, error) {
	if id == "" {
		return r.Screens[0], nil
	}
	i := slices.IndexFunc(r.Screens, func(s contract.Display) bool { return s.ID == id })
	if i < 0 {
		return contract.Display{}, fmt.Errorf("%w: unknown screen %q", contract.ErrInvalid, id)
	}
	return r.Screens[i], nil
}

// versions lists the configured Android versions, newest first.
func (r Redroid) versions() []string {
	out := slices.Collect(func(yield func(string) bool) {
		for v := range r.Images {
			if !yield(v) {
				return
			}
		}
	})
	slices.SortFunc(out, func(a, b string) int { return cmp.Or(compareVersions(b, a), strings.Compare(b, a)) })
	return out
}

func (r Redroid) image(version string) (string, string, error) {
	if version == "" {
		version = r.versions()[0]
	}
	image, ok := r.Images[version]
	if !ok {
		return "", "", fmt.Errorf("%w: unknown Android version %q", contract.ErrInvalid, version)
	}
	return version, image, nil
}

func compareVersions(a, b string) int {
	as, bs := strings.Split(a, "."), strings.Split(b, ".")
	for i := range max(len(as), len(bs)) {
		var x, y int
		if i < len(as) {
			x, _ = strconv.Atoi(as[i])
		}
		if i < len(bs) {
			y, _ = strconv.Atoi(bs[i])
		}
		if c := cmp.Compare(x, y); c != 0 {
			return c
		}
	}
	return 0
}
