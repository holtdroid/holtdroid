package api

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
)

const (
	maxFigmaLayers = 4000
	figmaPNGScale  = 3
)

var errFigmaToken = fmt.Errorf("%w: importing from Figma needs a personal access token: add yours in the Pixel perfect tab, or set pixelPerfect.figma.token on the server", contract.ErrInvalid)

type FigmaSource struct {
	FileKey  string    `json:"fileKey"`
	NodeID   string    `json:"nodeId"`
	URL      string    `json:"url"`
	Format   string    `json:"format" enum:"svg,png"`
	SyncedAt time.Time `json:"syncedAt"`
}

// FigmaLayers are a frame's layers in its own units (dp for a phone frame),
// relative to its top left corner.
type FigmaLayers struct {
	Width  float64      `json:"width"`
	Height float64      `json:"height"`
	Layers []FigmaLayer `json:"layers" doc:"depth first, the frame itself left out"`
}

type FigmaLayer struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Type         string     `json:"type"`
	Parent       int        `json:"parent" doc:"index in layers, -1 under the frame"`
	X            float64    `json:"x"`
	Y            float64    `json:"y"`
	W            float64    `json:"w"`
	H            float64    `json:"h"`
	Text         string     `json:"text,omitempty"`
	Fill         string     `json:"fill,omitempty" doc:"the top solid fill, #rrggbb or #rrggbbaa"`
	Stroke       string     `json:"stroke,omitempty"`
	StrokeWeight float64    `json:"strokeWeight,omitempty"`
	Radius       []float64  `json:"radius,omitempty" doc:"one value, or top left, top right, bottom right, bottom left"`
	Opacity      float64    `json:"opacity,omitempty" doc:"set when below 1"`
	Font         *FigmaFont `json:"font,omitempty"`
	Padding      []float64  `json:"padding,omitempty" doc:"auto layout: top, right, bottom, left"`
	Gap          float64    `json:"gap,omitempty" doc:"auto layout: space between items"`
}

type FigmaFont struct {
	Family        string  `json:"family"`
	Size          float64 `json:"size"`
	Weight        float64 `json:"weight,omitempty"`
	LineHeight    float64 `json:"lineHeight,omitempty" doc:"in the frame's units"`
	LetterSpacing float64 `json:"letterSpacing,omitempty"`
}

var (
	figmaPath = regexp.MustCompile(`^/(?:design|file|proto)/([A-Za-z0-9]+)(?:/branch/([A-Za-z0-9]+))?(?:/|$)`)
	figmaNode = regexp.MustCompile(`^\d+[:-]\d+$`)
)

// parseFigmaURL takes the file and the node from a link copied in Figma
// ("Copy link to selection").
func parseFigmaURL(raw string) (FigmaSource, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	host := ""
	if err == nil {
		host = strings.TrimPrefix(u.Hostname(), "www.")
	}
	m := figmaPath.FindStringSubmatch(u.EscapedPath())
	if err != nil || host != "figma.com" || m == nil {
		return FigmaSource{}, fmt.Errorf("%w: not a link to a Figma design", contract.ErrInvalid)
	}
	node := u.Query().Get("node-id")
	if !figmaNode.MatchString(node) {
		return FigmaSource{}, fmt.Errorf("%w: the link has no frame in it: select the frame in Figma and use Copy link to selection", contract.ErrInvalid)
	}
	return FigmaSource{FileKey: cmp.Or(m[2], m[1]), NodeID: strings.Replace(node, "-", ":", 1), URL: u.String()}, nil
}

type figmaColor struct{ R, G, B, A float64 }

type figmaPaint struct {
	Type    string      `json:"type"`
	Visible *bool       `json:"visible"`
	Opacity *float64    `json:"opacity"`
	Color   *figmaColor `json:"color"`
}

type figmaNodeDoc struct {
	ID                   string                                 `json:"id"`
	Name                 string                                 `json:"name"`
	Type                 string                                 `json:"type"`
	Visible              *bool                                  `json:"visible"`
	Box                  *struct{ X, Y, Width, Height float64 } `json:"absoluteBoundingBox"`
	Fills                []figmaPaint                           `json:"fills"`
	Strokes              []figmaPaint                           `json:"strokes"`
	StrokeWeight         float64                                `json:"strokeWeight"`
	CornerRadius         float64                                `json:"cornerRadius"`
	RectangleCornerRadii []float64                              `json:"rectangleCornerRadii"`
	Opacity              *float64                               `json:"opacity"`
	Characters           string                                 `json:"characters"`
	Style                *struct {
		FontFamily    string  `json:"fontFamily"`
		FontWeight    float64 `json:"fontWeight"`
		FontSize      float64 `json:"fontSize"`
		LineHeightPx  float64 `json:"lineHeightPx"`
		LetterSpacing float64 `json:"letterSpacing"`
	} `json:"style"`
	LayoutMode    string         `json:"layoutMode"`
	PaddingTop    float64        `json:"paddingTop"`
	PaddingRight  float64        `json:"paddingRight"`
	PaddingBottom float64        `json:"paddingBottom"`
	PaddingLeft   float64        `json:"paddingLeft"`
	ItemSpacing   float64        `json:"itemSpacing"`
	Children      []figmaNodeDoc `json:"children"`
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func paintHex(paints []figmaPaint) string {
	for _, p := range slices.Backward(paints) {
		if p.Type != "SOLID" || p.Color == nil || p.Visible != nil && !*p.Visible {
			continue
		}
		a := p.Color.A
		if p.Opacity != nil {
			a *= *p.Opacity
		}
		ch := func(v float64) string { return fmt.Sprintf("%02x", int(math.Round(math.Max(0, math.Min(1, v))*255))) }
		hex := "#" + ch(p.Color.R) + ch(p.Color.G) + ch(p.Color.B)
		if a < 0.999 {
			hex += ch(a)
		}
		return hex
	}
	return ""
}

// flattenFigma lists the visible layers under a frame, depth first.
func flattenFigma(frame figmaNodeDoc) FigmaLayers {
	out := FigmaLayers{Layers: []FigmaLayer{}}
	if frame.Box == nil {
		return out
	}
	ox, oy := frame.Box.X, frame.Box.Y
	out.Width, out.Height = round2(frame.Box.Width), round2(frame.Box.Height)
	var walk func(n figmaNodeDoc, parent int)
	walk = func(n figmaNodeDoc, parent int) {
		if n.Visible != nil && !*n.Visible || len(out.Layers) >= maxFigmaLayers {
			return
		}
		idx := parent
		if n.Box != nil && n.Box.Width > 0 && n.Box.Height > 0 {
			l := FigmaLayer{
				ID: n.ID, Name: n.Name, Type: n.Type, Parent: parent,
				X: round2(n.Box.X - ox), Y: round2(n.Box.Y - oy), W: round2(n.Box.Width), H: round2(n.Box.Height),
				Text: clipText(n.Characters, 120), Fill: paintHex(n.Fills), StrokeWeight: n.StrokeWeight,
			}
			if l.Stroke = paintHex(n.Strokes); l.Stroke == "" {
				l.StrokeWeight = 0
			}
			switch {
			case len(n.RectangleCornerRadii) == 4:
				l.Radius = n.RectangleCornerRadii
			case n.CornerRadius > 0:
				l.Radius = []float64{n.CornerRadius}
			}
			if n.Opacity != nil && *n.Opacity < 0.999 {
				l.Opacity = round2(*n.Opacity)
			}
			if n.Style != nil && n.Type == "TEXT" {
				l.Font = &FigmaFont{
					Family: n.Style.FontFamily, Size: n.Style.FontSize, Weight: n.Style.FontWeight,
					LineHeight: round2(n.Style.LineHeightPx), LetterSpacing: round2(n.Style.LetterSpacing),
				}
			}
			if n.LayoutMode == "HORIZONTAL" || n.LayoutMode == "VERTICAL" {
				l.Padding = []float64{n.PaddingTop, n.PaddingRight, n.PaddingBottom, n.PaddingLeft}
				l.Gap = n.ItemSpacing
			}
			idx = len(out.Layers)
			out.Layers = append(out.Layers, l)
		}
		for _, c := range n.Children {
			walk(c, idx)
		}
	}
	for _, c := range frame.Children {
		walk(c, -1)
	}
	return out
}

func clipText(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

type figmaAPIError struct {
	Status int
	Err    string `json:"err"`
	Msg    string `json:"message"`
}

func (s *Server) figmaGet(ctx context.Context, token, path string, q url.Values, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(s.cfg.PixelPerfect.Figma.URL, "/")+path+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Figma-Token", token)
	resp, err := s.figmaHTTP.Do(req)
	if err != nil {
		return fmt.Errorf("figma: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return fmt.Errorf("figma: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		var e figmaAPIError
		_ = json.Unmarshal(body, &e)
		msg := cmp.Or(e.Err, e.Msg, http.StatusText(resp.StatusCode))
		switch resp.StatusCode {
		case http.StatusForbidden, http.StatusUnauthorized:
			return fmt.Errorf("%w: Figma refused the token (%s); check that it can read this file", contract.ErrInvalid, msg)
		case http.StatusNotFound:
			return fmt.Errorf("%w: Figma has no such file or frame (%s)", contract.ErrNotFound, msg)
		case http.StatusTooManyRequests:
			return fmt.Errorf("%w: Figma is rate limiting this token; try again in a minute", contract.ErrBusy)
		}
		return fmt.Errorf("figma: %d %s", resp.StatusCode, msg)
	}
	return json.Unmarshal(body, v)
}

func (s *Server) figmaRender(ctx context.Context, token string, src FigmaSource, q url.Values, max int64) ([]byte, error) {
	q.Set("ids", src.NodeID)
	var r struct {
		Err    *string            `json:"err"`
		Images map[string]*string `json:"images"`
	}
	if err := s.figmaGet(ctx, token, "/v1/images/"+src.FileKey, q, &r); err != nil {
		return nil, err
	}
	link := r.Images[src.NodeID]
	if link == nil || *link == "" {
		if r.Err != nil {
			return nil, fmt.Errorf("figma couldn't render the frame: %s", *r.Err)
		}
		return nil, errors.New("figma couldn't render the frame")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, *link, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.figmaHTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("figma image: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("figma image: %s", resp.Status)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > max {
		return nil, fmt.Errorf("%w: the frame's image is larger than %d bytes; try PNG or SVG instead", contract.ErrTooLarge, max)
	}
	return raw, nil
}

type figmaFrame struct {
	name        string
	raw, thumb  []byte
	contentType string
	w, h        int
	layers      FigmaLayers
}

func (s *Server) fetchFigma(ctx context.Context, token string, src FigmaSource) (figmaFrame, error) {
	var nodes struct {
		Nodes map[string]*struct {
			Document figmaNodeDoc `json:"document"`
		} `json:"nodes"`
	}
	if err := s.figmaGet(ctx, token, "/v1/files/"+src.FileKey+"/nodes", url.Values{"ids": {src.NodeID}}, &nodes); err != nil {
		return figmaFrame{}, err
	}
	n := nodes.Nodes[src.NodeID]
	if n == nil || n.Document.Box == nil || n.Document.Box.Width <= 0 || n.Document.Box.Height <= 0 {
		return figmaFrame{}, fmt.Errorf("%w: Figma has no frame %s in this file", contract.ErrNotFound, src.NodeID)
	}
	doc := n.Document
	f := figmaFrame{name: doc.Name, layers: flattenFigma(doc)}
	max := int64(s.cfg.PixelPerfect.MaxFileSize)
	q := url.Values{"use_absolute_bounds": {"true"}}
	if src.Format == "png" {
		q.Set("format", "png")
		q.Set("scale", strconv.Itoa(figmaPNGScale))
	} else {
		q.Set("format", "svg")
		q.Set("svg_outline_text", "true")
	}
	raw, err := s.figmaRender(ctx, token, src, q, max)
	if err != nil {
		return figmaFrame{}, err
	}
	f.raw = raw
	if src.Format == "png" {
		cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
		if err != nil || format != "png" {
			return figmaFrame{}, errors.New("figma sent an image that isn't a PNG")
		}
		f.contentType, f.w, f.h = "image/png", cfg.Width, cfg.Height
	} else {
		w, h, ok := svgSize(raw)
		if !ok {
			return figmaFrame{}, errors.New("figma sent an SVG without a size")
		}
		f.contentType, f.w, f.h = svgType, w, h
		scale := math.Max(0.01, math.Min(1, float64(thumbWidth)*2/doc.Box.Width))
		small, err := s.figmaRender(ctx, token, src, url.Values{"format": {"png"}, "scale": {strconv.FormatFloat(round2(scale), 'f', -1, 64)}}, 8<<20)
		if err == nil {
			f.thumb, _ = makeThumbnail(small)
		}
	}
	if f.w <= 0 || f.h <= 0 || f.w*f.h > 64<<20 {
		return figmaFrame{}, fmt.Errorf("%w: the frame is %d×%d; at most 64 megapixels", contract.ErrInvalid, f.w, f.h)
	}
	return f, nil
}

func (s *Server) figmaToken(ctx context.Context, given string) (string, error) {
	if t := strings.TrimSpace(given); t != "" {
		return t, nil
	}
	ref := s.cfg.PixelPerfect.Figma.Token
	if ref.IsZero() {
		return "", errFigmaToken
	}
	t, err := s.secrets.Resolve(ctx, ref)
	if err != nil {
		s.log.Warn("pixel perfect: resolving pixelPerfect.figma.token failed", "err", err)
		return "", errors.New("the server's Figma token can't be read")
	}
	return t, nil
}

type figmaImportInput struct {
	Body struct {
		URL     string `json:"url" maxLength:"2048" doc:"a link to a frame: Copy link to selection in Figma"`
		Name    string `json:"name,omitempty" maxLength:"120" doc:"defaults to the frame's name"`
		Package string `json:"package,omitempty" maxLength:"255"`
		Format  string `json:"format,omitempty" enum:"svg,png" default:"svg" doc:"svg is drawn at any size; png is rendered at 3×"`
		Token   string `json:"token,omitempty" maxLength:"512" doc:"the user's Figma personal access token; the server's pixelPerfect.figma.token when empty. Used for this request only, never stored"`
	}
}

type figmaRefreshInput struct {
	ID   string `path:"id"`
	Body struct {
		Token string `json:"token,omitempty" maxLength:"512"`
	}
}

func (s *Server) importFigma(ctx context.Context, in *figmaImportInput) (ReferenceView, error) {
	if s.references == nil {
		return ReferenceView{}, errReferencesDisabled
	}
	src, err := parseFigmaURL(in.Body.URL)
	if err != nil {
		return ReferenceView{}, err
	}
	src.Format = cmp.Or(in.Body.Format, "svg")
	token, err := s.figmaToken(ctx, in.Body.Token)
	if err != nil {
		return ReferenceView{}, err
	}
	f, err := s.fetchFigma(ctx, token, src)
	if err != nil {
		return ReferenceView{}, err
	}
	who, _ := auth.FromContext(ctx)
	now := s.now().UTC()
	src.SyncedAt = now
	m := referenceMeta{
		ID: newAppDataID(now), Owner: who.User, Name: cmp.Or(cleanReferenceName(in.Body.Name), cleanReferenceName(f.name), "Figma frame"),
		Package: strings.TrimSpace(in.Body.Package), ContentType: f.contentType, Width: f.w, Height: f.h,
		Placement: Placement{Scale: 1}, CreatedAt: now, Figma: &src,
	}
	return s.saveReference(ctx, m, f.raw, f.thumb, &f.layers, 0)
}

func (s *Server) refreshFigma(ctx context.Context, in *figmaRefreshInput) (ReferenceView, error) {
	m, user, err := s.ownReference(ctx, in.ID)
	if err != nil {
		return ReferenceView{}, err
	}
	if m.Figma == nil {
		return ReferenceView{}, fmt.Errorf("%w: this reference wasn't imported from Figma", contract.ErrInvalid)
	}
	token, err := s.figmaToken(ctx, in.Body.Token)
	if err != nil {
		return ReferenceView{}, err
	}
	f, err := s.fetchFigma(ctx, token, *m.Figma)
	if err != nil {
		return ReferenceView{}, err
	}
	var previous int64
	if o, err := s.references.store.Stat(ctx, s.references.key(user, m.ID, ".img")); err == nil {
		previous = o.Size
	}
	src := *m.Figma
	src.SyncedAt = s.now().UTC()
	m.Figma, m.ContentType, m.Width, m.Height = &src, f.contentType, f.w, f.h
	m.Revision++
	return s.saveReference(ctx, m, f.raw, f.thumb, &f.layers, previous)
}

func (s *Server) registerFigma(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "importFigmaReference", Method: http.MethodPost, Path: referencesPath + "/figma", Tags: tags,
		DefaultStatus: http.StatusCreated,
		Description:   "Adds a Figma frame as a reference: its picture and its layers with their boxes, colours, fonts and auto layout spacing. Fails with 507 over the caller's quota.",
	}, func(ctx context.Context, in *figmaImportInput) (*out[ReferenceView], error) {
		v, err := s.importFigma(ctx, in)
		s.emitResult(ctx, audit.Event{Action: audit.ReferenceUpload, Details: map[string]string{"reference": v.ID, "name": v.Name, "source": "figma"}}, err)
		if errors.Is(err, errReferenceQuota) {
			return nil, huma.NewError(http.StatusInsufficientStorage, err.Error())
		}
		if err != nil {
			return nil, httpError(err)
		}
		return &out[ReferenceView]{v}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "refreshFigmaReference", Method: http.MethodPost, Path: referencesPath + "/{id}/figma", Tags: tags,
		Description: "Fetches the reference's Figma frame again, keeping where it sits and the ignored areas.",
	}, func(ctx context.Context, in *figmaRefreshInput) (*out[ReferenceView], error) {
		v, err := s.refreshFigma(ctx, in)
		if errors.Is(err, errReferenceQuota) {
			return nil, huma.NewError(http.StatusInsufficientStorage, err.Error())
		}
		if err != nil {
			return nil, httpError(err)
		}
		return &out[ReferenceView]{v}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "referenceLayers", Method: http.MethodGet, Path: referencesPath + "/{id}/layers", Tags: tags,
		Description: "The design layers of a reference imported from Figma.",
	}, func(ctx context.Context, in *referencePath) (*out[FigmaLayers], error) {
		m, user, err := s.ownReference(ctx, in.ID)
		if err == nil && m.Layers == 0 {
			err = fmt.Errorf("%w: reference %s has no layers", contract.ErrNotFound, in.ID)
		}
		var l FigmaLayers
		if err == nil {
			l, err = readJSON[FigmaLayers](ctx, s.references.store, s.references.key(user, m.ID, ".layers"))
		}
		if err != nil {
			return nil, httpError(err)
		}
		return &out[FigmaLayers]{l}, nil
	})
}
