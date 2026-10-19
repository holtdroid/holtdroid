package contract

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

// Node is served on every machine a provider runs devices on and tells it
// about that machine.
type Node interface {
	Host(ctx context.Context) (HostInfo, error)
}

func RegisterNode(api huma.API, n Node) {
	tags := []string{"node"}
	huma.Register(api, huma.Operation{OperationID: "getHost", Method: http.MethodGet, Path: "/v1/host", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*body[HostInfo], error) {
			h, err := n.Host(ctx)
			if err != nil {
				return nil, toHuma(err)
			}
			if h.Conditions == nil {
				h.Conditions = []string{}
			}
			if h.Thermal == nil {
				h.Thermal = []Temperature{}
			}
			return &body[HostInfo]{h}, nil
		})
	registerHealth(api, "node")
}

type NodeClient struct{ c client }

func NewNodeClient(baseURL string, hc *http.Client) *NodeClient {
	return &NodeClient{newClient(baseURL, hc)}
}

func (n *NodeClient) Host(ctx context.Context) (HostInfo, error) {
	var h HostInfo
	err := n.c.do(ctx, http.MethodGet, "/v1/host", nil, &h)
	return h, err
}
