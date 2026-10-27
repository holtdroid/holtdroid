package api

import (
	"math"
	"regexp"
	"slices"
)

const maxFigmaComponents = 20

// FigmaComponent is a part of a frame rendered on its own, so the UI can
// leave it out of the reference (decisions #145, #149).
type FigmaComponent struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Type  string  `json:"type"`
	Layer int     `json:"layer" doc:"its index in layers, -1 when it isn't listed"`
	X     float64 `json:"x" doc:"where its picture goes, in the frame's units: its rendered bounds, shadows included"`
	Y     float64 `json:"y"`
	W     float64 `json:"w"`
	H     float64 `json:"h"`
	Live  bool    `json:"live,omitempty" doc:"looks like live content (an image or video fill, or a name like video, player, camera, map), which the app shows differently every time"`
	URL   string  `json:"url" doc:"its picture, a PNG at the frame's scale"`
}

type figmaEffect struct {
	Type    string `json:"type"`
	Visible *bool  `json:"visible"`
}

type figmaBox struct{ X, Y, Width, Height float64 }

func visible(v *bool) bool { return v == nil || *v }

func visiblePaints(paints []figmaPaint) []figmaPaint {
	return slices.DeleteFunc(slices.Clone(paints), func(p figmaPaint) bool {
		return !visible(p.Visible) || p.Opacity != nil && *p.Opacity == 0
	})
}

func (n figmaNodeDoc) shown() bool {
	return visible(n.Visible) && n.Box != nil && n.Box.Width > 0 && n.Box.Height > 0
}

func (n figmaNodeDoc) shownChildren() []figmaNodeDoc {
	var out []figmaNodeDoc
	for _, c := range n.Children {
		if c.shown() {
			out = append(out, c)
		}
	}
	return out
}

const (
	minSplitShare      = 0.05
	instanceSplitShare = 0.5
	repeatShare        = 0.75
)

// splittable: drawing the children one by one gives the same picture, and
// they are worth telling apart. A component instance is one unless it covers
// most of the frame, a part under 5% of the frame stays whole, and so does a
// list or grid of the same thing.
func (n figmaNodeDoc) splittable(frameArea float64) bool {
	switch n.Type {
	case "FRAME", "GROUP", "SECTION":
	case "COMPONENT", "INSTANCE", "COMPONENT_SET":
		if area(n) < frameArea*instanceSplitShare {
			return false
		}
	default:
		return false
	}
	if area(n) < frameArea*minSplitShare {
		return false
	}
	if len(visiblePaints(n.Fills)) > 0 || len(visiblePaints(n.Strokes)) > 0 || n.ClipsContent || n.IsMask ||
		n.Opacity != nil && *n.Opacity < 0.999 || n.BlendMode != "" && n.BlendMode != "PASS_THROUGH" && n.BlendMode != "NORMAL" {
		return false
	}
	for _, e := range n.Effects {
		if visible(e.Visible) {
			return false
		}
	}
	for _, c := range n.Children {
		if c.IsMask {
			return false
		}
	}
	return len(n.shownChildren()) > 0 && !n.repeats()
}

// repeats: most of what the node holds, looking through plain frames and
// groups (rows of a grid), is instances of one component or layers of one
// name, so it is a list or a grid.
func (n figmaNodeDoc) repeats() bool {
	var keys []string
	var walk func(m figmaNodeDoc)
	walk = func(m figmaNodeDoc) {
		for _, c := range m.shownChildren() {
			switch {
			case c.ComponentID != "":
				keys = append(keys, "component:"+c.ComponentID)
			case (c.Type == "FRAME" || c.Type == "GROUP") && len(visiblePaints(c.Fills)) == 0 && len(c.shownChildren()) > 0:
				walk(c)
			default:
				keys = append(keys, "name:"+c.Name)
			}
		}
	}
	walk(n)
	if len(keys) < 3 {
		return false
	}
	counts := map[string]int{}
	most := 0
	for _, k := range keys {
		counts[k]++
		most = max(most, counts[k])
	}
	return float64(most) >= repeatShare*float64(len(keys))
}

// pickComponents splits a frame into about max parts: its children, with
// the largest splittable part replaced by its own children while that keeps
// within max. A frame with more children than max keeps them all, up to
// three times max. The order is the drawing order, bottom first.
func pickComponents(frame figmaNodeDoc, max int) []figmaNodeDoc {
	parts := frame.shownChildren()
	if len(parts) > 3*max || frame.Box == nil {
		return nil
	}
	frameArea := area(frame)
	for {
		best := -1
		for i, p := range parts {
			if !p.splittable(frameArea) || len(parts)-1+len(p.shownChildren()) > max {
				continue
			}
			if best < 0 || area(p) > area(parts[best]) {
				best = i
			}
		}
		if best < 0 {
			return parts
		}
		parts = slices.Concat(parts[:best], parts[best].shownChildren(), parts[best+1:])
	}
}

func area(n figmaNodeDoc) float64 { return n.Box.Width * n.Box.Height }

// figmaComposable says whether a frame can be drawn again from its parts: its
// own fill must be plain colour, and nothing in it may mask its siblings.
func figmaComposable(frame figmaNodeDoc) (background string, ok bool) {
	for _, p := range visiblePaints(frame.Fills) {
		if p.Type != "SOLID" {
			return "", false
		}
	}
	for _, c := range frame.Children {
		if c.IsMask {
			return "", false
		}
	}
	return paintHexAll(frame.Fills), true
}

// paintHexAll blends a node's visible solid fills, bottom first, into one colour.
func paintHexAll(paints []figmaPaint) string {
	var r, g, b, a float64
	for _, p := range visiblePaints(paints) {
		if p.Type != "SOLID" || p.Color == nil {
			continue
		}
		pa := p.Color.A
		if p.Opacity != nil {
			pa *= *p.Opacity
		}
		out := pa + a*(1-pa)
		if out <= 0 {
			continue
		}
		r = (p.Color.R*pa + r*a*(1-pa)) / out
		g = (p.Color.G*pa + g*a*(1-pa)) / out
		b = (p.Color.B*pa + b*a*(1-pa)) / out
		a = out
	}
	if a <= 0 {
		return ""
	}
	return paintHex([]figmaPaint{{Type: "SOLID", Color: &figmaColor{R: r, G: g, B: b, A: a}}})
}

var liveName = regexp.MustCompile(`(?i)video|player|stream|camera|preview|map|видео|плеер|стрим|камер|карт`)

// looksLive: a telling name, or an image or video fill over at least half
// of the part (a photo or a player, not an icon).
func looksLive(n figmaNodeDoc) bool {
	if liveName.MatchString(n.Name) {
		return true
	}
	return n.Box != nil && largeMedia(n, area(n)/2)
}

func largeMedia(n figmaNodeDoc, min float64) bool {
	if !visible(n.Visible) {
		return false
	}
	if n.Box != nil && area(n) >= min {
		for _, p := range visiblePaints(n.Fills) {
			if p.Type == "IMAGE" || p.Type == "VIDEO" {
				return true
			}
		}
	}
	return slices.ContainsFunc(n.Children, func(c figmaNodeDoc) bool { return largeMedia(c, min) })
}

// renderBounds is where a node's picture goes: its rendered bounds with
// shadows and blurs, or its box when Figma didn't send them.
func (n figmaNodeDoc) renderBounds() figmaBox {
	if b := n.RenderBox; b != nil && b.Width > 0 && b.Height > 0 {
		return *b
	}
	return *n.Box
}

// figmaScale is the largest scale up to 4× whose picture stays under a
// size a browser handles comfortably.
func figmaScale(w, h float64) float64 {
	const maxPixels = 24 << 20
	s := math.Min(4, math.Sqrt(maxPixels/(w*h)))
	return math.Max(0.5, math.Floor(s*4)/4)
}

func componentLayer(layers []FigmaLayer, id string) int {
	return slices.IndexFunc(layers, func(l FigmaLayer) bool { return l.ID == id })
}
