package emulator

import (
	"cmp"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/holtdroid/holtdroid/internal/contract"
)

//go:embed devices.json
var devicesJSON []byte

// DefaultScreens are the generic screens of popular budget and mid-range
// phones, by resolution and density class, followed by a catalog of real
// devices; the first screen is the default and the cheapest to stream.
func DefaultScreens() []contract.Display {
	hole := &contract.CutoutShape{Kind: "circle", Top: 11, Width: 24}
	drop := &contract.CutoutShape{Kind: "drop", Width: 48, Height: 24}
	screens := []contract.Display{
		{ID: "hd", Label: "HD+", Like: "Galaxy A05, Redmi 13C", Width: 720, Height: 1600, DPI: 280, Radius: 8, Shape: drop},
		{ID: "fhd-samsung", Label: "FHD+ 19.5:9", Like: "Galaxy A15, A25, A35", Width: 1080, Height: 2340, DPI: 420, Radius: 16, Shape: drop},
		{ID: "fhd", Label: "FHD+ 20:9", Like: "Pixel 6a–8a, Moto G54, Realme C67", Width: 1080, Height: 2400, DPI: 420, Radius: 28, Shape: hole},
		{ID: "fhd-tall", Label: "FHD+ tall", Like: "Infinix Hot 40", Width: 1080, Height: 2460, DPI: 420, Radius: 20, Shape: hole},
		{ID: "1.5k", Label: "1.5K", Like: "Redmi Note 13 Pro, Poco X6", Width: 1220, Height: 2712, DPI: 480, Radius: 32, Shape: hole},
		{ID: "classic", Label: "Classic 16:9", Like: "Galaxy S5, Nexus 5X, Moto G4", Width: 1080, Height: 1920, DPI: 480},
		{ID: "compact", Label: "Compact 18:9", Like: "Redmi 6A, Galaxy J4+", Width: 720, Height: 1440, DPI: 320, Radius: 8},
		{ID: "flat", Label: "FHD+ flat", Like: "Under-display camera and slider phones", Width: 1080, Height: 2400, DPI: 420, Radius: 24},
		{ID: "tablet", Label: "Tablet", Like: "Galaxy Tab A9+", Width: 1200, Height: 1920, DPI: 240, Radius: 12},
	}
	var catalog []contract.Display
	if err := json.Unmarshal(devicesJSON, &catalog); err != nil {
		panic("emulator: devices.json: " + err.Error())
	}
	return append(screens, catalog...)
}

// overlayFor is the Android cutout overlay whose insets are closest to a shape.
func overlayFor(s *contract.CutoutShape) string {
	switch {
	case s == nil:
		return "none"
	case (s.Kind == "circle" || s.Kind == "pill") && s.Align == "left":
		return "corner"
	case s.Kind == "circle" || s.Kind == "pill":
		return "hole"
	default:
		return "tall"
	}
}

// shapeFor draws what an overlay would look like when a screen only names it.
func shapeFor(cutout string) *contract.CutoutShape {
	switch cutout {
	case "tall", "double":
		return &contract.CutoutShape{Kind: "notch", Width: 128, Height: 32}
	case "hole":
		return &contract.CutoutShape{Kind: "circle", Top: 8.5, Width: 21}
	case "corner":
		return &contract.CutoutShape{Kind: "circle", Align: "left", Offset: 24, Top: 13.5, Width: 21}
	}
	return nil
}

// complete fills a screen's Cutout and Shape from each other.
func complete(screens []contract.Display) []contract.Display {
	out := slices.Clone(screens)
	for i, s := range out {
		switch {
		case s.Shape == nil:
			out[i].Shape = shapeFor(s.Cutout)
		case s.Cutout == "":
			out[i].Cutout = overlayFor(s.Shape)
		}
		if out[i].Cutout == "" {
			out[i].Cutout = "none"
		}
	}
	return out
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
		case s.Radius < 0:
			return fmt.Errorf("redroid.screens[%s]: radius must not be negative", s.ID)
		case s.Cutout != "" && !slices.Contains(contract.Cutouts, s.Cutout):
			return fmt.Errorf("redroid.screens[%s]: cutout must be one of %s", s.ID, strings.Join(contract.Cutouts, ", "))
		case s.Shape != nil && (!slices.Contains([]string{"circle", "pill", "drop", "notch"}, s.Shape.Kind) || s.Shape.Width <= 0 || s.Shape.Height < 0 || s.Shape.Top < 0):
			return fmt.Errorf("redroid.screens[%s]: shape needs a kind (circle, pill, drop, notch), a positive width and no negative size or top", s.ID)
		case s.Shape != nil && s.Shape.Align != "" && !slices.Contains([]string{"left", "center", "right"}, s.Shape.Align):
			return fmt.Errorf("redroid.screens[%s]: shape align must be left, center or right", s.ID)
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

// model names a screen for the session's capabilities.
func model(d contract.Display) string {
	m := strings.TrimSpace(d.Brand + " " + d.Label)
	m = fmt.Sprintf("%s %d×%d", m, d.Width, d.Height)
	if d.Like != "" {
		m += " · " + d.Like
	}
	return m
}
