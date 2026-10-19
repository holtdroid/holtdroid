package contract_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/provider/fake"
)

func serve(t *testing.T, register func(huma.API)) string {
	t.Helper()
	mux := http.NewServeMux()
	register(humago.New(mux, huma.DefaultConfig("test", "v1")))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestProviderRoundTrip(t *testing.T) {
	p := fake.New(fake.Config{Slots: 1, StepDelay: time.Hour, PublicURL: "http://agents"})
	c := contract.NewProviderClient(serve(t, func(api huma.API) { contract.RegisterProvider(api, p) }), nil)
	ctx := context.Background()

	caps, err := c.Capabilities(ctx)
	if err != nil || caps.Display != contract.DisplayScrcpy || len(caps.Locations) == 0 {
		t.Fatalf("capabilities %+v, %v", caps, err)
	}

	s, err := c.Create(ctx, contract.CreateSession{ArtifactURL: "http://api/x", ArtifactRef: "src/x", Package: "com.x", Owner: "otter", Location: "pl"})
	if err != nil || s.State != contract.StateProvisioning || s.AgentURL != "http://agents/agents/"+s.ID {
		t.Fatalf("create %+v, %v", s, err)
	}
	if _, err := c.Create(ctx, contract.CreateSession{ArtifactURL: "http://api/x", ArtifactRef: "src/x", Package: "com.x", Owner: "otter"}); !errors.Is(err, contract.ErrNoCapacity) {
		t.Fatalf("second create: %v", err)
	}
	if _, err := c.Create(ctx, contract.CreateSession{ArtifactRef: "src/x", Package: "com.x", Owner: "otter"}); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("invalid create: %v", err)
	}

	capacity, err := c.Capacity(ctx)
	if err != nil || capacity.Free() != 0 {
		t.Fatalf("capacity %+v, %v", capacity, err)
	}

	at := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	if err := c.Touch(ctx, s.ID, at); err != nil {
		t.Fatal(err)
	}
	got, err := c.Get(ctx, s.ID)
	if err != nil || !got.LastActivity.Equal(at) {
		t.Fatalf("after touch %+v, %v", got, err)
	}

	if _, err := c.Install(ctx, s.ID, contract.Install{ArtifactURL: "http://api/y", ArtifactRef: "src/y", KeepData: true}); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("install before ready: %v", err)
	}

	inv, err := c.Inventory(ctx)
	if err != nil || len(inv.Devices) != 1 || inv.Devices[0].Session != s.ID || inv.Devices[0].Device == nil {
		t.Fatalf("inventory %+v, %v", inv, err)
	}
	if err := c.SetMaintenance(ctx, contract.SetMaintenance{Slot: "nope", Enabled: true}); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("maintenance of an unknown slot: %v", err)
	}
	if err := c.SetMaintenance(ctx, contract.SetMaintenance{Enabled: true, Reason: "upgrade", By: "root"}); err != nil {
		t.Fatal(err)
	}
	if capacity, err := c.Capacity(ctx); err != nil || capacity.Maintenance == nil || capacity.Slots[0].State != contract.SlotBusy || capacity.Slots[0].Maintenance.By != "root" {
		t.Fatalf("held capacity %+v, %v", capacity, err)
	}

	list, err := c.List(ctx)
	if err != nil || len(list) != 1 {
		t.Fatalf("list %+v, %v", list, err)
	}
	if err := c.Delete(ctx, s.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Get(ctx, s.ID); !errors.Is(err, contract.ErrNotFound) {
		t.Fatalf("get after delete: %v", err)
	}
}

type node contract.HostInfo

func (n node) Host(context.Context) (contract.HostInfo, error) { return contract.HostInfo(n), nil }

func TestNodeRoundTrip(t *testing.T) {
	c := contract.NewNodeClient(serve(t, func(api huma.API) { contract.RegisterNode(api, node{CPU: "i5", Load1: 0.5}) }), nil)
	h, err := c.Host(context.Background())
	if err != nil || h.CPU != "i5" || h.Load1 != 0.5 || h.Thermal == nil || h.Conditions == nil {
		t.Fatalf("host %+v, %v", h, err)
	}
}
