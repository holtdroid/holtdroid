package api

import (
	"bytes"
	"encoding/xml"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"math"
	"strconv"
	"strings"

	xdraw "golang.org/x/image/draw"
)

const (
	svgType        = "image/svg+xml"
	thumbWidth     = 160
	thumbMaxHeight = 320
	thumbMaxBytes  = 256 << 10
	thumbMaxPixels = 24 << 20
)

func svgLength(v string) float64 {
	v = strings.TrimSuffix(strings.TrimSpace(v), "px")
	f, err := strconv.ParseFloat(v, 64)
	if err != nil || f <= 0 || math.IsInf(f, 0) {
		return 0
	}
	return f
}

// svgSize reads the size of an SVG from its root's width and height, or its
// viewBox when they are missing or relative.
func svgSize(raw []byte) (int, int, bool) {
	d := xml.NewDecoder(bytes.NewReader(raw))
	d.Strict = false
	for {
		tok, err := d.Token()
		if err != nil {
			return 0, 0, false
		}
		se, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		if se.Name.Local != "svg" {
			return 0, 0, false
		}
		var w, h float64
		var box []string
		for _, a := range se.Attr {
			switch a.Name.Local {
			case "width":
				w = svgLength(a.Value)
			case "height":
				h = svgLength(a.Value)
			case "viewBox":
				box = strings.FieldsFunc(a.Value, func(r rune) bool { return r == ' ' || r == ',' || r == '\t' || r == '\n' })
			}
		}
		if (w == 0 || h == 0) && len(box) == 4 {
			bw, bh := svgLength(box[2]), svgLength(box[3])
			switch {
			case w == 0 && h == 0:
				w, h = bw, bh
			case w == 0 && bh > 0:
				w = h * bw / bh
			case h == 0 && bw > 0:
				h = w * bh / bw
			}
		}
		iw, ih := int(math.Ceil(w)), int(math.Ceil(h))
		return iw, ih, iw > 0 && ih > 0 && iw <= 16384 && ih <= 16384
	}
}

// thumbnailSize is the list's picture of an image: a fixed width and the
// top of tall images.
func thumbnailSize(w, h int) (int, int) {
	return thumbWidth, min(thumbMaxHeight, max(1, int(math.Round(float64(thumbWidth)*float64(h)/float64(w)))))
}

// makeThumbnail renders a raster image's thumbnail as a JPEG on white; big
// images are left without one rather than decoded whole.
func makeThumbnail(raw []byte) ([]byte, bool) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || cfg.Width*cfg.Height > thumbMaxPixels {
		return nil, false
	}
	src, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, false
	}
	b := src.Bounds()
	tw, th := thumbnailSize(b.Dx(), b.Dy())
	crop := image.Rect(b.Min.X, b.Min.Y, b.Max.X, b.Min.Y+min(b.Dy(), int(math.Round(float64(th)*float64(b.Dx())/float64(tw)))))
	dst := image.NewRGBA(image.Rect(0, 0, tw, th))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, crop, xdraw.Over, nil)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 80}); err != nil {
		return nil, false
	}
	return out.Bytes(), true
}

// validThumbnail accepts a thumbnail the browser made, for SVGs the server
// doesn't render.
func validThumbnail(raw []byte) bool {
	if len(raw) == 0 || len(raw) > thumbMaxBytes {
		return false
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	return err == nil && referenceTypes[format] != "" && cfg.Width <= 2*thumbWidth && cfg.Height <= 2*thumbMaxHeight
}
