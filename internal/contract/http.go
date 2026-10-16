package contract

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
)

func toHuma(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, ErrNotFound):
		return huma.Error404NotFound(err.Error())
	case errors.Is(err, ErrNoCapacity):
		return huma.Error409Conflict(err.Error())
	case errors.Is(err, ErrInvalid):
		return huma.Error400BadRequest(err.Error())
	default:
		return huma.Error500InternalServerError(err.Error())
	}
}

func registerHealth(api huma.API, tag string) {
	huma.Register(api, huma.Operation{OperationID: "health", Method: http.MethodGet, Path: "/v1/health", Tags: []string{tag}},
		func(context.Context, *struct{}) (*body[Health], error) {
			return &body[Health]{Health{OK: true}}, nil
		})
}

type client struct {
	base string
	hc   *http.Client
}

func newClient(baseURL string, hc *http.Client) client {
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return client{base: strings.TrimRight(baseURL, "/"), hc: hc}
}

type ErrorDetail struct {
	Message  string `json:"message"`
	Location string `json:"location"`
}

type StatusError struct {
	Status int
	Detail string
	Errors []ErrorDetail
}

func (e *StatusError) Error() string { return fmt.Sprintf("%d: %s", e.Status, e.Detail) }

func (e *StatusError) Unwrap() error {
	switch e.Status {
	case http.StatusNotFound:
		return ErrNotFound
	case http.StatusConflict:
		return ErrNoCapacity
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		return ErrInvalid
	}
	return nil
}

func (c client) raw(ctx context.Context, method, path string, in any) (*http.Response, error) {
	var reader io.Reader
	if in != nil {
		raw, err := json.Marshal(in)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return nil, err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		defer resp.Body.Close()
		var problem struct {
			Detail string        `json:"detail"`
			Errors []ErrorDetail `json:"errors"`
		}
		_ = json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&problem)
		if problem.Detail == "" {
			problem.Detail = resp.Status
		}
		return nil, &StatusError{Status: resp.StatusCode, Detail: problem.Detail, Errors: problem.Errors}
	}
	return resp, nil
}

func (c client) do(ctx context.Context, method, path string, in, out any) error {
	resp, err := c.raw(ctx, method, path, in)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if out == nil || resp.StatusCode == http.StatusNoContent {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// NewAPI creates a huma API on mux for a contract server. The OpenAPI
// document is served at /openapi.json.
func NewAPI(mux *http.ServeMux, title string) huma.API {
	cfg := huma.DefaultConfig(title, "v1")
	cfg.DocsPath = ""
	cfg.SchemasPath = ""
	cfg.CreateHooks = nil
	return humago.New(mux, cfg)
}

// AgentOpenAPI describes the device agent API, used to generate the web client.
func AgentOpenAPI() *huma.OpenAPI {
	api := NewAPI(http.NewServeMux(), "Holtdroid device agent")
	RegisterAgent(api, nil)
	return api.OpenAPI()
}

func init() {
	huma.DefaultArrayNullable = false
}
