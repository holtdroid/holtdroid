package api

import (
	"context"
	"net/http"
	"net/netip"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/contract"
)

// IPInfoList is where the addresses are; Database is empty when the api
// has no geolocation database, and then only CDN and private addresses are
// told apart.
type IPInfoList struct {
	Database  string            `json:"database,omitempty" doc:"the databases' source and build date, shown as attribution"`
	Addresses []contract.IPInfo `json:"addresses"`
}

type ipInfoBody struct {
	Addresses []string `json:"addresses" maxItems:"2000"`
}

type ipInfoInput struct {
	Body ipInfoBody
}

type sharedIPInfoInput struct {
	Token string `path:"token"`
	Body  ipInfoBody
}

func (s *Server) ipInfo(in []string) IPInfoList {
	l := IPInfoList{Addresses: make([]contract.IPInfo, 0, len(in))}
	if b := s.geoip.Built(); !b.IsZero() {
		l.Database = "DB-IP Lite, " + b.Format("2006-01")
	}
	for _, a := range in {
		addr, err := netip.ParseAddr(a)
		if err != nil {
			continue
		}
		l.Addresses = append(l.Addresses, s.geoip.Lookup(addr))
	}
	return l
}

func (s *Server) registerIPInfo(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "lookupIPInfo", Method: http.MethodPost, Path: "/api/v1/ip-info", Tags: tags,
		Description: "Country, continent and autonomous system of addresses, and whether they are a CDN's edge; unparsable ones are left out.",
	}, func(_ context.Context, in *ipInfoInput) (*out[IPInfoList], error) {
		return &out[IPInfoList]{s.ipInfo(in.Body.Addresses)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "lookupSharedIPInfo", Method: http.MethodPost, Path: "/api/v1/shared/{token}/ip-info", Tags: tags,
		Description: "The same for a recording opened through a share link; needs no sign-in.",
	}, func(ctx context.Context, in *sharedIPInfoInput) (*out[IPInfoList], error) {
		if _, err := s.sharedRecording(ctx, in.Token); err != nil {
			return nil, httpError(err)
		}
		return &out[IPInfoList]{s.ipInfo(in.Body.Addresses)}, nil
	})
}
