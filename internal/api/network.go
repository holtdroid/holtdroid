package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/auth"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/db"
	"github.com/holtdroid/holtdroid/internal/netem"
)

const (
	networkBackendsPath = "/api/v1/network-backends/{package}"
	routesInterval      = 5 * time.Minute
)

// NetworkBackends are the hosts a user marked as an app's backends for
// network regions.
type NetworkBackends struct {
	Persistent bool     `json:"persistent" doc:"the database keeps them across restarts; when false the UI keeps them in the browser instead"`
	Backends   []string `json:"backends"`
}

type networkBackendsInput struct {
	Package string `path:"package" pattern:"^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$" maxLength:"255"`
}

type networkBackendsPut struct {
	Package string `path:"package" pattern:"^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$" maxLength:"255"`
	Body    struct {
		Backends []string `json:"backends" maxItems:"16"`
	}
}

var errMemoryDatabase = errors.New("the database is in memory, so backends are kept in the browser")

func (s *Server) persistentDB() bool { return s.cfg.Database.Type == "sqlite" }

func (s *Server) registerNetwork(api huma.API) {
	tags := []string{"ui"}

	huma.Register(api, huma.Operation{
		OperationID: "getNetworkBackends", Method: http.MethodGet, Path: networkBackendsPath, Tags: tags,
		Description: "The caller's backends for an app's network regions; empty unless the database is persistent.",
	}, func(ctx context.Context, in *networkBackendsInput) (*out[NetworkBackends], error) {
		nb := NetworkBackends{Persistent: s.persistentDB(), Backends: []string{}}
		if !nb.Persistent {
			return &out[NetworkBackends]{nb}, nil
		}
		who, _ := auth.FromContext(ctx)
		row, err := s.db.GetNetworkBackends(ctx, db.GetNetworkBackendsParams{Owner: who.User, Package: in.Package})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, httpError(err)
		}
		if row != "" {
			nb.Backends = strings.Split(row, "\n")
		}
		return &out[NetworkBackends]{nb}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "putNetworkBackends", Method: http.MethodPut, Path: networkBackendsPath, Tags: tags,
		Description: "Saves the caller's backends for an app; 409 while the database is in memory.",
	}, func(ctx context.Context, in *networkBackendsPut) (*out[NetworkBackends], error) {
		if !s.persistentDB() {
			return nil, huma.Error409Conflict(errMemoryDatabase.Error())
		}
		backends, err := netem.CleanBackends(in.Body.Backends)
		if err != nil {
			return nil, httpError(err)
		}
		who, _ := auth.FromContext(ctx)
		if err := s.db.PutNetworkBackends(ctx, db.PutNetworkBackendsParams{
			Owner: who.User, Package: in.Package, Backends: strings.Join(backends, "\n"), UpdatedAt: s.now(),
		}); err != nil {
			return nil, httpError(err)
		}
		return &out[NetworkBackends]{NetworkBackends{Persistent: true, Backends: append([]string{}, backends...)}}, nil
	})
}

// cachedRoute is the route a session measured last through a provider's
// location, empty for the provider's default; nil when none did.
func (s *Server) cachedRoute(ctx context.Context, provider, location string) *contract.NetworkRoute {
	if location == "" {
		caps, err := s.providers[provider].Capabilities(ctx)
		if err != nil {
			return nil
		}
		location = caps.DefaultLocation
	}
	if location == "" {
		return nil
	}
	row, err := s.db.GetNetworkRoute(ctx, db.GetNetworkRouteParams{Provider: provider, Location: location})
	if err != nil {
		return nil
	}
	var r contract.NetworkRoute
	if json.Unmarshal([]byte(row), &r) != nil {
		return nil
	}
	return &r
}

func (s *Server) routesLoop(ctx context.Context) {
	t := time.NewTicker(routesInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.collectRoutes(ctx)
		}
	}
}

// collectRoutes keeps the routes ready sessions measured, per provider and
// location, for the next session there to start from.
func (s *Server) collectRoutes(ctx context.Context) {
	all, _ := s.allSessions(ctx)
	for provider, items := range all {
		for _, sess := range items {
			if sess.State != contract.StateReady {
				continue
			}
			if err := s.collectRoute(ctx, provider, sess.ID); err != nil {
				s.log.Debug("network route", "provider", provider, "session", sess.ID, "err", err)
			}
		}
	}
}

func (s *Server) collectRoute(ctx context.Context, provider, id string) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	c, err := s.agentClient(ctx, provider, id)
	if err != nil {
		return err
	}
	n, err := c.Network(ctx)
	if err != nil || n.Route == nil || n.Route.At.IsZero() || n.Location == "" {
		return err
	}
	route, err := json.Marshal(n.Route)
	if err != nil {
		return err
	}
	return s.db.PutNetworkRoute(ctx, db.PutNetworkRouteParams{
		Provider: provider, Location: n.Location, Route: string(route), MeasuredAt: n.Route.At,
	})
}
