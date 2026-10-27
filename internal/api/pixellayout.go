package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/storage"
)

const (
	layoutPresetsPath = referencesPath + "/presets"
	maxLayoutPresets  = 50
)

// Insets are distances from the screen's edges in dp, so one area fits every
// screen size and density (decision #147).
type Insets struct {
	Top    float64 `json:"top" minimum:"0" maximum:"2000"`
	Right  float64 `json:"right" minimum:"0" maximum:"2000"`
	Bottom float64 `json:"bottom" minimum:"0" maximum:"2000"`
	Left   float64 `json:"left" minimum:"0" maximum:"2000"`
}

// WorkArea is the part of the screen a reference is laid out and compared in.
type WorkArea struct {
	Kind   string `json:"kind" enum:"screen,insets,box" doc:"screen: all of it; insets: the screen less these dp; box: a rectangle as fractions of the screen"`
	Insets Insets `json:"insets"`
	Box    Rect   `json:"box"`
}

// Grid is drawn inside the work area, in dp.
type Grid struct {
	Columns  int     `json:"columns" minimum:"0" maximum:"24" doc:"0 for no column grid"`
	Margin   float64 `json:"margin" minimum:"0" maximum:"500"`
	Gutter   float64 `json:"gutter" minimum:"0" maximum:"500"`
	Baseline float64 `json:"baseline" minimum:"0" maximum:"200" doc:"rows every so many dp, 0 for none"`
}

type Guide struct {
	Axis string  `json:"axis" enum:"x,y" doc:"x: a vertical line at pos from the area's left edge; y: a horizontal one from its top"`
	Pos  float64 `json:"pos" minimum:"-2000" maximum:"5000" doc:"dp"`
}

// ReferenceLayout is where a reference is worked with: the area, the grid
// and the guides.
type ReferenceLayout struct {
	Area   WorkArea `json:"area"`
	Grid   Grid     `json:"grid"`
	Guides []Guide  `json:"guides" maxItems:"64"`
}

type LayoutPreset struct {
	ID   string `json:"id" maxLength:"40" pattern:"^[A-Za-z0-9_-]+$"`
	Name string `json:"name" minLength:"1" maxLength:"80"`
	ReferenceLayout
}

type LayoutPresets struct {
	Items []LayoutPreset `json:"items" maxItems:"50"`
}

func defaultLayout() ReferenceLayout {
	return ReferenceLayout{Area: WorkArea{Kind: "screen"}, Guides: []Guide{}}
}

func validLayout(l ReferenceLayout) error {
	if l.Area.Kind == "box" {
		if err := validRects([]Rect{l.Area.Box}); err != nil {
			return fmt.Errorf("%w: the work area lies outside the screen", contract.ErrInvalid)
		}
	}
	return nil
}

func (s *Server) presetsKey(user string) string { return s.references.prefix + user + "/presets.json" }

func (s *Server) registerLayoutPresets(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "getLayoutPresets", Method: http.MethodGet, Path: layoutPresetsPath, Tags: tags,
		Description: "The caller's saved work areas with their grids and guides, for any reference and device.",
	}, func(ctx context.Context, _ *struct{}) (*out[LayoutPresets], error) {
		if s.references == nil {
			return nil, httpError(errReferencesDisabled)
		}
		who, _ := auth.FromContext(ctx)
		p, err := readJSON[LayoutPresets](ctx, s.references.store, s.presetsKey(userDir(who.User)))
		if err != nil && !errors.Is(err, storage.ErrNotExist) && !errors.Is(err, contract.ErrNotFound) {
			return nil, httpError(err)
		}
		if p.Items == nil {
			p.Items = []LayoutPreset{}
		}
		return &out[LayoutPresets]{p}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "putLayoutPresets", Method: http.MethodPut, Path: layoutPresetsPath, Tags: tags,
		Description: "Replaces the caller's saved work areas.",
	}, func(ctx context.Context, in *struct{ Body LayoutPresets }) (*out[LayoutPresets], error) {
		if s.references == nil {
			return nil, httpError(errReferencesDisabled)
		}
		seen := map[string]bool{}
		for i, p := range in.Body.Items {
			if seen[p.ID] {
				return nil, httpError(fmt.Errorf("%w: preset id %q twice", contract.ErrInvalid, p.ID))
			}
			seen[p.ID] = true
			if err := validLayout(p.ReferenceLayout); err != nil {
				return nil, httpError(err)
			}
			in.Body.Items[i].Name = strings.TrimSpace(p.Name)
			if in.Body.Items[i].Guides == nil {
				in.Body.Items[i].Guides = []Guide{}
			}
		}
		if in.Body.Items == nil {
			in.Body.Items = []LayoutPreset{}
		}
		who, _ := auth.FromContext(ctx)
		if err := writeJSON(ctx, s.references.store, s.presetsKey(userDir(who.User)), in.Body); err != nil {
			return nil, httpError(err)
		}
		return &out[LayoutPresets]{in.Body}, nil
	})
}
