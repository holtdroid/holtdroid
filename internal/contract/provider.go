package contract

import (
	"context"
	"net/http"
	"net/url"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

type Provider interface {
	Capabilities(ctx context.Context) (Capabilities, error)
	Capacity(ctx context.Context) (Capacity, error)
	List(ctx context.Context) ([]Session, error)
	Create(ctx context.Context, req CreateSession) (Session, error)
	Get(ctx context.Context, id string) (Session, error)
	Delete(ctx context.Context, id string) error
	Touch(ctx context.Context, id string, at time.Time) error
	Install(ctx context.Context, id string, req Install) (Session, error)
	Inventory(ctx context.Context) (Inventory, error)
	SetMaintenance(ctx context.Context, req SetMaintenance) error
}

type createSessionInput struct {
	Body CreateSession
}

type touchInput struct {
	ID   string `path:"id" minLength:"1"`
	Body Touch
}

type setMaintenanceInput struct {
	Body SetMaintenance
}

type installSessionInput struct {
	ID   string `path:"id" minLength:"1"`
	Body Install
}

func RegisterProvider(api huma.API, p Provider) {
	tags := []string{"provider"}

	huma.Register(api, huma.Operation{OperationID: "getCapabilities", Method: http.MethodGet, Path: "/v1/capabilities", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*body[Capabilities], error) {
			c, err := p.Capabilities(ctx)
			if err != nil {
				return nil, toHuma(err)
			}
			if c.Locations == nil {
				c.Locations = []Location{}
			}
			if c.ABIs == nil {
				c.ABIs = []string{}
			}
			return &body[Capabilities]{c}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "getCapacity", Method: http.MethodGet, Path: "/v1/capacity", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*body[Capacity], error) {
			c, err := p.Capacity(ctx)
			if err != nil {
				return nil, toHuma(err)
			}
			if c.Slots == nil {
				c.Slots = []Slot{}
			}
			return &body[Capacity]{c}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "listSessions", Method: http.MethodGet, Path: "/v1/sessions", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*body[SessionList], error) {
			items, err := p.List(ctx)
			if err != nil {
				return nil, toHuma(err)
			}
			if items == nil {
				items = []Session{}
			}
			return &body[SessionList]{SessionList{Items: items}}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "createSession", Method: http.MethodPost, Path: "/v1/sessions", Tags: tags, DefaultStatus: http.StatusCreated,
	}, func(ctx context.Context, in *createSessionInput) (*body[Session], error) {
		s, err := p.Create(ctx, in.Body)
		if err != nil {
			return nil, toHuma(err)
		}
		return &body[Session]{s}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "getSession", Method: http.MethodGet, Path: "/v1/sessions/{id}", Tags: tags},
		func(ctx context.Context, in *idInput) (*body[Session], error) {
			s, err := p.Get(ctx, in.ID)
			if err != nil {
				return nil, toHuma(err)
			}
			return &body[Session]{s}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "deleteSession", Method: http.MethodDelete, Path: "/v1/sessions/{id}", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *idInput) (*struct{}, error) {
		return nil, toHuma(p.Delete(ctx, in.ID))
	})

	huma.Register(api, huma.Operation{
		OperationID: "touchSession", Method: http.MethodPost, Path: "/v1/sessions/{id}/touch", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *touchInput) (*struct{}, error) {
		return nil, toHuma(p.Touch(ctx, in.ID, in.Body.LastActivity))
	})

	huma.Register(api, huma.Operation{
		OperationID: "installSession", Method: http.MethodPost, Path: "/v1/sessions/{id}/install", Tags: tags,
		Description: "Installs another build of the session's package through its agent and records it as the session's artifact.",
	}, func(ctx context.Context, in *installSessionInput) (*body[Session], error) {
		s, err := p.Install(ctx, in.ID, in.Body)
		if err != nil {
			return nil, toHuma(err)
		}
		return &body[Session]{s}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "getInventory", Method: http.MethodGet, Path: "/v1/inventory", Tags: tags,
		Description: "Every slot with what the provider knows about its device or machine.",
	}, func(ctx context.Context, _ *struct{}) (*body[Inventory], error) {
		inv, err := p.Inventory(ctx)
		if err != nil {
			return nil, toHuma(err)
		}
		if inv.Devices == nil {
			inv.Devices = []InventoryDevice{}
		}
		return &body[Inventory]{inv}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "setMaintenance", Method: http.MethodPut, Path: "/v1/maintenance", Tags: tags, DefaultStatus: http.StatusNoContent,
		Description: "Holds a slot or the whole provider for maintenance, or releases it. Held slots take no new sessions.",
	}, func(ctx context.Context, in *setMaintenanceInput) (*struct{}, error) {
		return nil, toHuma(p.SetMaintenance(ctx, in.Body))
	})

	registerHealth(api, "provider")
}

type ProviderClient struct{ c client }

func NewProviderClient(baseURL string, hc *http.Client) *ProviderClient {
	return &ProviderClient{newClient(baseURL, hc)}
}

func (p *ProviderClient) Capabilities(ctx context.Context) (Capabilities, error) {
	var c Capabilities
	err := p.c.do(ctx, http.MethodGet, "/v1/capabilities", nil, &c)
	return c, err
}

func (p *ProviderClient) Capacity(ctx context.Context) (Capacity, error) {
	var c Capacity
	err := p.c.do(ctx, http.MethodGet, "/v1/capacity", nil, &c)
	return c, err
}

func (p *ProviderClient) List(ctx context.Context) ([]Session, error) {
	var l SessionList
	err := p.c.do(ctx, http.MethodGet, "/v1/sessions", nil, &l)
	return l.Items, err
}

func (p *ProviderClient) Create(ctx context.Context, req CreateSession) (Session, error) {
	var s Session
	err := p.c.do(ctx, http.MethodPost, "/v1/sessions", req, &s)
	return s, err
}

func (p *ProviderClient) Get(ctx context.Context, id string) (Session, error) {
	var s Session
	err := p.c.do(ctx, http.MethodGet, "/v1/sessions/"+url.PathEscape(id), nil, &s)
	return s, err
}

func (p *ProviderClient) Delete(ctx context.Context, id string) error {
	return p.c.do(ctx, http.MethodDelete, "/v1/sessions/"+url.PathEscape(id), nil, nil)
}

func (p *ProviderClient) Touch(ctx context.Context, id string, at time.Time) error {
	return p.c.do(ctx, http.MethodPost, "/v1/sessions/"+url.PathEscape(id)+"/touch", Touch{LastActivity: at}, nil)
}

func (p *ProviderClient) Install(ctx context.Context, id string, req Install) (Session, error) {
	var s Session
	err := p.c.withTimeout(installTimeout).do(ctx, http.MethodPost, "/v1/sessions/"+url.PathEscape(id)+"/install", req, &s)
	return s, err
}

func (p *ProviderClient) Inventory(ctx context.Context) (Inventory, error) {
	var inv Inventory
	err := p.c.do(ctx, http.MethodGet, "/v1/inventory", nil, &inv)
	return inv, err
}

func (p *ProviderClient) SetMaintenance(ctx context.Context, req SetMaintenance) error {
	return p.c.do(ctx, http.MethodPut, "/v1/maintenance", req, nil)
}
