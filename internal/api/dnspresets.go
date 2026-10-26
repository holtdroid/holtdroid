package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/agent/dns"
	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/db"
)

const (
	dnsPresetsPath = "/api/v1/dns-presets"
	maxDNSPresets  = 100
)

// DNSPreset is a set of DNS rewrites and a TTL limit a user saved to load
// into a session later; a new session never starts with one.
type DNSPreset struct {
	ID        string               `json:"id"`
	Name      string               `json:"name"`
	Settings  contract.DNSSettings `json:"settings"`
	CreatedAt time.Time            `json:"createdAt"`
	UpdatedAt time.Time            `json:"updatedAt"`
}

type DNSPresetList struct {
	Items []DNSPreset `json:"items"`
}

type DNSPresetInput struct {
	Name     string               `json:"name" minLength:"1" maxLength:"80"`
	Settings contract.DNSSettings `json:"settings"`
}

type dnsPresetBody struct {
	Body DNSPresetInput
}

type dnsPresetUpdate struct {
	ID   string `path:"id"`
	Body DNSPresetInput
}

type dnsPresetID struct {
	ID string `path:"id"`
}

func (s *Server) registerDNSPresets(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "listDNSPresets", Method: http.MethodGet, Path: dnsPresetsPath, Tags: tags,
		Description: "The caller's saved DNS rewrite sets, most recently changed first.",
	}, func(ctx context.Context, _ *struct{}) (*out[DNSPresetList], error) {
		who, _ := auth.FromContext(ctx)
		rows, err := s.db.ListDNSPresets(ctx, who.User)
		if err != nil {
			return nil, httpError(err)
		}
		l := DNSPresetList{Items: make([]DNSPreset, 0, len(rows))}
		for _, r := range rows {
			if p, err := dnsPreset(r); err == nil {
				l.Items = append(l.Items, p)
			}
		}
		return &out[DNSPresetList]{l}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "createDNSPreset", Method: http.MethodPost, Path: dnsPresetsPath, Tags: tags, DefaultStatus: http.StatusCreated,
		Description: fmt.Sprintf("Saves a set of DNS rewrites and a TTL limit; at most %d per user.", maxDNSPresets),
	}, func(ctx context.Context, in *dnsPresetBody) (*out[DNSPreset], error) {
		who, _ := auth.FromContext(ctx)
		name, settings, err := cleanDNSPreset(in.Body)
		if err != nil {
			return nil, httpError(err)
		}
		n, err := s.db.CountDNSPresets(ctx, who.User)
		if err != nil {
			return nil, httpError(err)
		}
		if n >= maxDNSPresets {
			return nil, httpError(fmt.Errorf("%w: at most %d saved DNS sets", contract.ErrInvalid, maxDNSPresets))
		}
		now := s.now().UTC()
		p := DNSPreset{ID: randomHex(8), Name: name, Settings: settings, CreatedAt: now, UpdatedAt: now}
		raw, _ := json.Marshal(settings)
		if err := s.db.CreateDNSPreset(ctx, db.CreateDNSPresetParams{
			ID: p.ID, Owner: who.User, Name: name, Settings: string(raw), CreatedAt: now, UpdatedAt: now,
		}); err != nil {
			return nil, httpError(err)
		}
		return &out[DNSPreset]{p}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "updateDNSPreset", Method: http.MethodPut, Path: dnsPresetsPath + "/{id}", Tags: tags,
		Description: "Renames a saved DNS set or replaces what it holds.",
	}, func(ctx context.Context, in *dnsPresetUpdate) (*out[DNSPreset], error) {
		who, _ := auth.FromContext(ctx)
		name, settings, err := cleanDNSPreset(in.Body)
		if err != nil {
			return nil, httpError(err)
		}
		now := s.now().UTC()
		raw, _ := json.Marshal(settings)
		n, err := s.db.UpdateDNSPreset(ctx, db.UpdateDNSPresetParams{Name: name, Settings: string(raw), UpdatedAt: now, ID: in.ID, Owner: who.User})
		if err == nil && n == 0 {
			err = fmt.Errorf("%w: DNS set %s", contract.ErrNotFound, in.ID)
		}
		if err != nil {
			return nil, httpError(err)
		}
		r, err := s.db.GetDNSPreset(ctx, db.GetDNSPresetParams{ID: in.ID, Owner: who.User})
		if err != nil {
			return nil, httpError(err)
		}
		p, err := dnsPreset(r)
		if err != nil {
			return nil, httpError(err)
		}
		return &out[DNSPreset]{p}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "deleteDNSPreset", Method: http.MethodDelete, Path: dnsPresetsPath + "/{id}", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *dnsPresetID) (*struct{}, error) {
		who, _ := auth.FromContext(ctx)
		n, err := s.db.DeleteDNSPreset(ctx, db.DeleteDNSPresetParams{ID: in.ID, Owner: who.User})
		if err == nil && n == 0 {
			err = fmt.Errorf("%w: DNS set %s", contract.ErrNotFound, in.ID)
		}
		return nil, httpError(err)
	})
}

func cleanDNSPreset(in DNSPresetInput) (string, contract.DNSSettings, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return "", contract.DNSSettings{}, fmt.Errorf("%w: the set needs a name", contract.ErrInvalid)
	}
	settings, err := dns.Clean(in.Settings)
	return name, settings, err
}

func dnsPreset(r db.DnsPreset) (DNSPreset, error) {
	p := DNSPreset{ID: r.ID, Name: r.Name, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
	if err := json.Unmarshal([]byte(r.Settings), &p.Settings); err != nil {
		return DNSPreset{}, err
	}
	if p.Settings.Rewrites == nil {
		p.Settings.Rewrites = []contract.DNSRewrite{}
	}
	return p, nil
}
