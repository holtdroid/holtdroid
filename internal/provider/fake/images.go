package fake

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math/rand/v2"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const fakeShop = "https://shop.example.com/"

type fakeAsset struct {
	id, url, kind, mime string
	body                []byte
	text                bool
}

// fakeAssets are a page's pictures that go wrong in the usual ways, for the
// Images and SVG tabs: an avatar eight times the size it is drawn at, a
// JPEG hero below the fold, a PNG nothing shows, an icon file and a bundle
// whose paths keep six decimals.
var fakeAssets = sync.OnceValue(func() []fakeAsset {
	r := rand.New(rand.NewPCG(1, 2))
	noisy := func(w, h int) *image.RGBA {
		img := image.NewRGBA(image.Rect(0, 0, w, h))
		for y := range h {
			for x := range w {
				n := uint8(r.IntN(24))
				img.Set(x, y, color.RGBA{uint8(x * 255 / w), uint8(y * 255 / h), 160 + n, 255})
			}
		}
		return img
	}
	encodePNG := func(img image.Image) []byte {
		var b bytes.Buffer
		_ = png.Encode(&b, img)
		return b.Bytes()
	}
	var hero bytes.Buffer
	_ = jpeg.Encode(&hero, noisy(1280, 720), &jpeg.Options{Quality: 95})
	path := "M12.000000 2.250000C6.615234 2.250000 2.250000 6.615234 2.250000 12.000000C2.250000 17.384766 6.615234 21.750000 12.000000 21.750000C17.384766 21.750000 21.750000 17.384766 21.750000 12.000000C21.750000 6.615234 17.384766 2.250000 12.000000 2.250000Z"
	cart := "M 3.000000 4.000000 L 5.250000 4.000000 L 7.500000 15.000000 L 18.000000 15.000000 L 20.250000 7.500000 L 6.000000 7.500000"
	icons := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="` + cart + `"/><path d="` + path + `"/></svg>`
	bundle := fmt.Sprintf(`import{jsx as e}from"react";const Circle=()=>e("svg",{viewBox:"0 0 24 24",children:e("path",{d:%q})});`+
		`const Cart=()=>e("svg",{viewBox:"0 0 24 24",children:e("path",{d:%q})});const Ring=()=>e("svg",{viewBox:"0 0 24 24",children:e("path",{d:%q})});`,
		path, cart, path)
	return []fakeAsset{
		{id: "fake.img.avatar", url: fakeShop + "img/avatar.png", kind: "Image", mime: "image/png", body: encodePNG(noisy(256, 256))},
		{id: "fake.img.hero", url: fakeShop + "img/hero.jpg", kind: "Image", mime: "image/jpeg", body: hero.Bytes()},
		{id: "fake.img.promo", url: fakeShop + "img/promo.png", kind: "Image", mime: "image/png", body: encodePNG(noisy(320, 160))},
		{id: "fake.img.icons", url: fakeShop + "icons.svg", kind: "Image", mime: "image/svg+xml", body: []byte(icons), text: true},
		{id: "fake.img.bundle", url: fakeShop + "assets/vendor.4b1e.js", kind: "Script", mime: "application/javascript", body: []byte(bundle), text: true},
	}
})

func (a fakeAsset) request(now time.Time, start int64, withBody bool) contract.DevToolsRequest {
	r := contract.DevToolsRequest{
		ID: a.id, Start: start, Response: start + 18, End: start + 40, Wall: now.UnixMilli(), Method: "GET", URL: a.url,
		ResourceType: a.kind, Status: 200, StatusText: "OK", MimeType: a.mime, Protocol: "h2", RemoteAddress: "203.0.113.20:443",
		ResponseHeaders: map[string]string{"content-type": a.mime, "cache-control": "public, max-age=86400"},
		Size:            int64(len(a.body) + 220),
	}
	if withBody {
		if a.text {
			r.Body = string(a.body)
		} else {
			r.Body, r.BodyBase64 = base64.StdEncoding.EncodeToString(a.body), true
		}
	}
	return r
}

// fakeImages is what the shop page draws: the hero below the fold until
// heroShown, the icons as a CSS background and an inline SVG.
func fakeImages(heroShown bool) *contract.DevToolsImages {
	im := &contract.DevToolsImages{URL: fakeShop, Width: 412, Height: 915, DPR: 2.625}
	if heroShown {
		im.Uses = []contract.DevToolsImageUse{{Element: 2, Src: fakeShop + "img/hero.jpg", Kind: "img", Width: 380, Height: 213.8, NaturalWidth: 1280, NaturalHeight: 720, Fit: "cover", Shown: true}}
		return im
	}
	im.Uses = []contract.DevToolsImageUse{
		{Element: 1, Src: fakeShop + "img/avatar.png", Kind: "img", Width: 32, Height: 32, NaturalWidth: 256, NaturalHeight: 256, Shown: true},
		{Element: 2, Src: fakeShop + "img/hero.jpg", Kind: "img", Width: 380, Height: 213.8, NaturalWidth: 1280, NaturalHeight: 720, Fit: "cover"},
		{Element: 3, Src: fakeShop + "icons.svg", Kind: "css", Width: 24, Height: 24, Fit: "24px 24px", Shown: true},
		{Element: 4, Src: "https://shop.example.com/assets/logo.png", Kind: "img", Width: 120, Height: 40, NaturalWidth: 360, NaturalHeight: 120, Shown: true},
	}
	im.SVGs = []string{`<svg viewBox="0 0 24 24" width="24" height="24"><path d="M 4.000000 12.000000 L 9.000000 17.000000 L 20.000000 6.000000" fill="none" stroke="currentColor"/></svg>`}
	return im
}

func (d *device) DevToolsBody(_ context.Context, _, request string) (contract.DevToolsBody, error) {
	for _, a := range fakeAssets() {
		if a.id != request {
			continue
		}
		if a.text {
			return contract.DevToolsBody{Body: string(a.body)}, nil
		}
		return contract.DevToolsBody{Body: base64.StdEncoding.EncodeToString(a.body), Base64: true}, nil
	}
	return contract.DevToolsBody{}, fmt.Errorf("%w: no body for %s", contract.ErrNotFound, request)
}
