package emulator

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func TestMaintenance(t *testing.T) {
	p := newProvider(t, cluster(), nil)
	ctx := t.Context()

	if err := p.SetMaintenance(ctx, contract.SetMaintenance{Slot: "arm-1", Enabled: true}); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("unknown slot: %v", err)
	}
	if err := p.SetMaintenance(ctx, contract.SetMaintenance{Slot: "k3s-1", Enabled: true, Reason: "new fan", By: "otter"}); err != nil {
		t.Fatal(err)
	}
	c, err := p.Capacity(ctx)
	if err != nil || c.Slots[0].ID != "k3s-1" || c.Slots[0].State != contract.SlotMaintenance || c.Slots[0].Maintenance.Reason != "new fan" || !c.Slots[0].Maintenance.Since.Equal(epoch) {
		t.Fatalf("capacity %+v, %v", c, err)
	}
	s, err := p.Create(ctx, req)
	if err != nil || s.Slot != "k3s-2" {
		t.Fatalf("create %+v, %v", s, err)
	}

	if err := p.SetMaintenance(ctx, contract.SetMaintenance{Enabled: true, Reason: "upgrade"}); err != nil {
		t.Fatal(err)
	}
	if got := slotStates(t, p); got["k3s-1"] != "maintenance" || got["k3s-2"] != "busy" || got["k3s-3"] != "maintenance" {
		t.Fatalf("held provider %v", got)
	}
	if _, err := p.Create(ctx, req); !errors.Is(err, contract.ErrNoCapacity) {
		t.Fatalf("create while held: %v", err)
	}

	if err := p.SetMaintenance(ctx, contract.SetMaintenance{Enabled: false}); err != nil {
		t.Fatal(err)
	}
	if err := p.SetMaintenance(ctx, contract.SetMaintenance{Slot: "k3s-1", Enabled: false}); err != nil {
		t.Fatal(err)
	}
	if got := slotStates(t, p); got["k3s-1"] != "free" || got["k3s-3"] != "offline" {
		t.Fatalf("released %v", got)
	}

	off := newProvider(t, cluster(), func(c *Config) { c.Maintenance = "" })
	if err := off.SetMaintenance(ctx, contract.SetMaintenance{Enabled: true}); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("without a configmap: %v", err)
	}
}

type staticNode contract.HostInfo

func (n staticNode) Host(context.Context) (contract.HostInfo, error) {
	return contract.HostInfo(n), nil
}

func TestInventory(t *testing.T) {
	mux := http.NewServeMux()
	contract.RegisterNode(humago.New(mux, huma.DefaultConfig("test", "v1")), staticNode{
		CPU: "Intel(R) Core(TM) i5-8500T", Cores: 6, Load1: 1.5, MemoryAvailable: 8 << 30,
		Thermal: []contract.Temperature{{Source: contract.TemperatureHost, Type: "coretemp", Name: "Package id 0", Celsius: 52}},
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	host, port, _ := net.SplitHostPort(srv.Listener.Addr().String())

	kube := cluster()
	n, _ := kube.Tracker().Get(corev1.SchemeGroupVersion.WithResource("nodes"), "", "k3s-1")
	k1 := n.(*corev1.Node)
	k1.Status.NodeInfo = corev1.NodeSystemInfo{OSImage: "NixOS 25.05", KernelVersion: "6.12.40", Architecture: "amd64", KubeletVersion: "v1.33.4+k3s1"}
	k1.Status.Capacity = corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("6"), corev1.ResourceMemory: resource.MustParse("31Gi")}
	k1.Status.Conditions = append(k1.Status.Conditions, corev1.NodeCondition{Type: corev1.NodeDiskPressure, Status: corev1.ConditionTrue})
	if err := kube.Tracker().Update(corev1.SchemeGroupVersion.WithResource("nodes"), k1, ""); err != nil {
		t.Fatal(err)
	}
	if err := kube.Tracker().Add(&corev1.Pod{
		Name: "node-info-abc", Namespace: "holtdroid", Labels: map[string]string{"app": "node-info"},
		Spec:   corev1.PodSpec{NodeName: "k3s-1"},
		Status: corev1.PodStatus{Phase: corev1.PodRunning, PodIP: host},
	}); err != nil {
		t.Fatal(err)
	}
	p := newProvider(t, kube, func(c *Config) {
		c.NodeInfo = NodeInfo{Selector: "app=node-info"}
		c.NodeInfo.Port, _ = strconv.Atoi(port)
	})
	p.agents = srv.Client()
	ctx := t.Context()
	s, err := p.Create(ctx, req)
	if err != nil {
		t.Fatal(err)
	}

	inv, err := p.Inventory(ctx)
	if err != nil || len(inv.Devices) != 3 {
		t.Fatalf("inventory %+v, %v", inv, err)
	}
	k := inv.Devices[0]
	if k.Slot.ID != "k3s-1" || k.Session != s.ID || k.Error != "" || k.Host == nil {
		t.Fatalf("k3s-1 %+v", k)
	}
	h := k.Host
	if h.Hostname != "k3s-1" || h.OS != "NixOS 25.05" || h.Kubelet != "v1.33.4+k3s1" || h.CPU != "Intel(R) Core(TM) i5-8500T" || h.MemoryTotal != 31<<30 ||
		h.Load1 != 1.5 || len(h.Thermal) != 1 || len(h.Conditions) != 1 || h.Conditions[0] != "DiskPressure" {
		t.Errorf("k3s-1 host %+v", h)
	}
	if k3 := inv.Devices[2]; k3.Error != "node-info: no running pod on this node" || k3.Host.Conditions[0] != "NotReady" {
		t.Errorf("k3s-3 %+v", k3)
	}
}
