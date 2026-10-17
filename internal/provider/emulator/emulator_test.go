package emulator

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	"sigs.k8s.io/yaml"

	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/secrets"
	"github.com/kriakiku/holtdroid/internal/vpn"
)

var update = flag.Bool("update", false, "rewrite golden files")

type fakeSecrets map[secrets.Ref]string

func (f fakeSecrets) Resolve(_ context.Context, ref secrets.Ref) (string, error) {
	v, ok := f[ref]
	if !ok {
		return "", errors.New("not found")
	}
	return v, nil
}

var (
	epoch = time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	req   = contract.CreateSession{
		ArtifactURL: "http://holtdroid-api-internal:8081/internal/artifacts/abc",
		ArtifactRef: "slack/C1/F1/app.apk@1f2e",
		Package:     "com.example.app",
		Owner:       "otter",
	}
)

func vpnConfig() vpn.Config {
	c := vpn.DefaultConfig()
	c.Resolver = "10.43.0.10"
	c.Locations = []vpn.Location{
		{ID: "pl", Label: "Poland", Outbound: map[string]any{
			"type": "socks", "server": "vpn-socks.vpn.svc.cluster.local", "server_port": 1080, "username": "pl", "password": "holtdroid", "udp_over_tcp": true,
		}},
		{ID: "nl", Label: "Netherlands", Outbound: "file:/run/secrets/nl.json"},
	}
	return c
}

var sec = fakeSecrets{"file:/run/secrets/nl.json": `{"type":"socks","server":"10.0.0.9","server_port":1080}`}

func TestRender(t *testing.T) {
	tests := []struct {
		name     string
		cfg      func(*Config)
		location string
	}{
		{"plain", func(c *Config) {}, ""},
		{"vpn", func(c *Config) {
			c.VPN = vpnConfig()
			c.ImagePullSecrets = []string{"ghcr"}
			c.Tolerations = []Toleration{{Key: "dedicated", Operator: "Equal", Value: "nas", Effect: "NoSchedule"}}
		}, "nl"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := DefaultConfig()
			cfg.Image = "ghcr.io/kriakiku/holtdroid-session:0123abc"
			tt.cfg(&cfg)
			p, err := New(cfg, fake.NewClientset(), sec)
			if err != nil {
				t.Fatal(err)
			}
			pod := p.renderPod("0a1b2c3d4e", "k3s-1", req, tt.location, epoch)
			got, err := yaml.Marshal(pod)
			if err != nil {
				t.Fatal(err)
			}
			if cfg.VPN.Enabled() {
				pod.UID = "6c1f9e0a-0000-4000-8000-000000000001"
				conf, err := cfg.VPN.Render(t.Context(), sec, tt.location)
				if err != nil {
					t.Fatal(err)
				}
				secret, err := yaml.Marshal(renderSecret(pod, conf))
				if err != nil {
					t.Fatal(err)
				}
				got = append(append(got, "---\n"...), secret...)
			}
			golden := filepath.Join("testdata", tt.name+".yaml")
			if *update {
				if err := os.WriteFile(golden, got, 0o644); err != nil {
					t.Fatal(err)
				}
			}
			want, err := os.ReadFile(golden)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, want) {
				t.Errorf("render differs from %s (run with -update):\n%s", golden, got)
			}
		})
	}
}

func node(name string, ready bool, taints ...corev1.Taint) *corev1.Node {
	status := corev1.ConditionFalse
	if ready {
		status = corev1.ConditionTrue
	}
	return &corev1.Node{
		Name: name, Labels: map[string]string{"holtdroid/kvm": "true"},
		Spec:   corev1.NodeSpec{Taints: taints},
		Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: status}}},
	}
}

func cluster() *fake.Clientset {
	return fake.NewClientset(
		node("k3s-1", true),
		node("k3s-2", true),
		node("k3s-3", false),
		node("core", true, corev1.Taint{Key: "dedicated", Value: "nas", Effect: corev1.TaintEffectNoSchedule}),
		&corev1.Node{Name: "arm-1"},
	)
}

func newProvider(t *testing.T, kube *fake.Clientset, edit func(*Config)) *Provider {
	t.Helper()
	cfg := DefaultConfig()
	cfg.NodeSelector = "holtdroid/kvm=true"
	cfg.VPN = vpnConfig()
	if edit != nil {
		edit(&cfg)
	}
	p, err := New(cfg, kube, sec, WithClock(func() time.Time { return epoch }))
	if err != nil {
		t.Fatal(err)
	}
	p.agents = &http.Client{Transport: unreachable{}}
	return p
}

type unreachable struct{}

func (unreachable) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("agent unreachable")
}

func slotStates(t *testing.T, p contract.Provider) map[string]contract.SlotState {
	t.Helper()
	c, err := p.Capacity(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]contract.SlotState{}
	for _, s := range c.Slots {
		out[s.ID] = s.State
	}
	return out
}

func TestCapacity(t *testing.T) {
	tests := []struct {
		name string
		edit func(*Config)
		want map[string]contract.SlotState
	}{
		{"selector", nil, map[string]contract.SlotState{"k3s-1": "free", "k3s-2": "free", "k3s-3": "offline"}},
		{"tolerations", func(c *Config) {
			c.Tolerations = []Toleration{{Key: "dedicated", Operator: "Exists"}}
		}, map[string]contract.SlotState{"core": "free", "k3s-1": "free", "k3s-2": "free", "k3s-3": "offline"}},
		{"slots cap", func(c *Config) { c.Slots = 1 }, map[string]contract.SlotState{"k3s-1": "free"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := slotStates(t, newProvider(t, cluster(), tt.edit))
			if len(got) != len(tt.want) {
				t.Fatalf("slots %v, want %v", got, tt.want)
			}
			for k, v := range tt.want {
				if got[k] != v {
					t.Fatalf("slots %v, want %v", got, tt.want)
				}
			}
		})
	}
}

func TestValidate(t *testing.T) {
	tests := []struct {
		name string
		edit func(*Config)
	}{
		{"namespace", func(c *Config) { c.Namespace = "" }},
		{"selector", func(c *Config) { c.NodeSelector = "a in (" }},
		{"resources", func(c *Config) { c.Resources.Limits = map[string]string{"cpu": "lots"} }},
		{"pull policy", func(c *Config) { c.ImagePullPolicy = "Sometimes" }},
		{"vpn", func(c *Config) {
			c.VPN.Locations = []vpn.Location{{ID: "direct", Outbound: map[string]any{"type": "direct"}}}
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := DefaultConfig()
			tt.edit(&cfg)
			if cfg.Validate() == nil {
				t.Fatal("want an error")
			}
		})
	}
	if err := DefaultConfig().Validate(); err != nil {
		t.Fatal(err)
	}
}

func setStatus(t *testing.T, kube *fake.Clientset, id string, status corev1.PodStatus) {
	t.Helper()
	pods := kube.CoreV1().Pods("holtdroid")
	pod, err := pods.Get(t.Context(), podName(id), metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	pod.Status = status
	if _, err := pods.UpdateStatus(t.Context(), pod, metav1.UpdateOptions{}); err != nil {
		t.Fatal(err)
	}
}

func TestRoundTrip(t *testing.T) {
	kube := cluster()
	mux := http.NewServeMux()
	contract.RegisterProvider(contract.NewAPI(mux, "test"), newProvider(t, kube, nil))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	c := contract.NewProviderClient(srv.URL, nil)
	ctx := t.Context()

	caps, err := c.Capabilities(ctx)
	if err != nil || caps.Kind != "emulator" || len(caps.Locations) != 3 || caps.DefaultLocation != "direct" {
		t.Fatalf("capabilities %+v, %v", caps, err)
	}

	if _, err := c.Create(ctx, contract.CreateSession{ArtifactURL: req.ArtifactURL, ArtifactRef: req.ArtifactRef, Package: req.Package, Owner: req.Owner, Location: "mars"}); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("unknown location: %v", err)
	}

	first, err := c.Create(ctx, req)
	if err != nil || first.Slot != "k3s-1" || first.State != contract.StateProvisioning || first.Location != "direct" || first.AgentURL != "" || !first.CreatedAt.Equal(epoch) {
		t.Fatalf("create %+v, %v", first, err)
	}
	secret, err := kube.CoreV1().Secrets("holtdroid").Get(ctx, podName(first.ID), metav1.GetOptions{})
	if err != nil || len(secret.OwnerReferences) != 1 || secret.OwnerReferences[0].Name != podName(first.ID) || secret.StringData[vpnConfigKey] == "" {
		t.Fatalf("secret %+v, %v", secret, err)
	}

	withPL := req
	withPL.Location = "pl"
	second, err := c.Create(ctx, withPL)
	if err != nil || second.Slot != "k3s-2" || second.Location != "pl" {
		t.Fatalf("second create %+v, %v", second, err)
	}
	if _, err := c.Create(ctx, req); !errors.Is(err, contract.ErrNoCapacity) {
		t.Fatalf("third create: %v", err)
	}
	if got := slotStates(t, c); got["k3s-1"] != "busy" || got["k3s-2"] != "busy" || got["k3s-3"] != "offline" {
		t.Fatalf("capacity %v", got)
	}

	states := []struct {
		status    corev1.PodStatus
		want      contract.SessionState
		wantAgent string
	}{
		{corev1.PodStatus{Phase: corev1.PodPending}, contract.StateProvisioning, ""},
		{corev1.PodStatus{Phase: corev1.PodRunning, PodIP: "10.42.1.7", ContainerStatuses: []corev1.ContainerStatus{
			{Name: "emulator", State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}},
		}}, contract.StateBooting, "http://10.42.1.7:8080"},
		{corev1.PodStatus{Phase: corev1.PodRunning, PodIP: "10.42.1.7", ContainerStatuses: []corev1.ContainerStatus{
			{Name: "emulator", Ready: true, State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}},
		}}, contract.StateReady, "http://10.42.1.7:8080"},
		{corev1.PodStatus{Phase: corev1.PodRunning, PodIP: "10.42.1.7", ContainerStatuses: []corev1.ContainerStatus{
			{Name: "emulator", State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{ExitCode: 1, Reason: "Error"}}},
			{Name: "vpn", Ready: true, State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}},
		}}, contract.StateFailed, "http://10.42.1.7:8080"},
	}
	for _, s := range states {
		setStatus(t, kube, first.ID, s.status)
		got, err := c.Get(ctx, first.ID)
		if err != nil || got.State != s.want || got.AgentURL != s.wantAgent {
			t.Fatalf("pod %+v: session %+v, %v", s.status, got, err)
		}
		if wantTunnel := strings.Replace(s.wantAgent, ":8080", ":8081", 1); got.TunnelURL != wantTunnel {
			t.Fatalf("tunnel url %q, want %q", got.TunnelURL, wantTunnel)
		}
		if s.want == contract.StateFailed && got.Reason != "emulator exited with code 1: Error" {
			t.Fatalf("reason %q", got.Reason)
		}
	}

	at := epoch.Add(10 * time.Minute)
	if err := c.Touch(ctx, first.ID, at); err != nil {
		t.Fatal(err)
	}
	if got, err := c.Get(ctx, first.ID); err != nil || !got.LastActivity.Equal(at) {
		t.Fatalf("after touch %+v, %v", got, err)
	}

	list, err := c.List(ctx)
	if err != nil || len(list) != 2 {
		t.Fatalf("list %+v, %v", list, err)
	}
	if err := c.Delete(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	for _, err := range []error{c.Delete(ctx, first.ID), c.Touch(ctx, first.ID, at)} {
		if !errors.Is(err, contract.ErrNotFound) {
			t.Fatalf("after delete: %v", err)
		}
	}
	if _, err := c.Get(ctx, "nope"); !errors.Is(err, contract.ErrNotFound) {
		t.Fatalf("get unknown: %v", err)
	}
	if got := slotStates(t, c); got["k3s-1"] != "free" {
		t.Fatalf("capacity after delete %v", got)
	}
}

func TestNoVPN(t *testing.T) {
	p := newProvider(t, cluster(), func(c *Config) { c.VPN = vpn.DefaultConfig() })
	caps, _ := p.Capabilities(t.Context())
	if len(caps.Locations) != 0 || caps.DefaultLocation != "" {
		t.Fatalf("capabilities %+v", caps)
	}
	withLocation := req
	withLocation.Location = "pl"
	if _, err := p.Create(t.Context(), withLocation); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("location without vpn: %v", err)
	}
	s, err := p.Create(t.Context(), req)
	if err != nil || s.Location != "" {
		t.Fatalf("create %+v, %v", s, err)
	}
	secrets, _ := p.kube.CoreV1().Secrets("holtdroid").List(t.Context(), metav1.ListOptions{})
	if len(secrets.Items) != 0 {
		t.Fatalf("secrets %v", secrets.Items)
	}
}

func TestAgentStatus(t *testing.T) {
	var status atomic.Value
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/state" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(status.Load().(string)))
	}))
	t.Cleanup(agent.Close)
	port, _ := strconv.Atoi(agent.URL[strings.LastIndex(agent.URL, ":")+1:])

	kube := cluster()
	p := newProvider(t, kube, func(c *Config) { c.AgentPort = port })
	p.agents = agent.Client()
	s, err := p.Create(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	running := corev1.PodStatus{Phase: corev1.PodRunning, PodIP: "127.0.0.1", ContainerStatuses: []corev1.ContainerStatus{
		{Name: "emulator", State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}},
	}}
	setStatus(t, kube, s.ID, running)

	tests := []struct {
		body       string
		want       contract.SessionState
		wantReason string
	}{
		{`{"state":"installing","detail":"adb install"}`, contract.StateInstalling, ""},
		{`{"state":"failed","reason":"install: INSTALL_FAILED_NO_MATCHING_ABIS"}`, contract.StateFailed, "install: INSTALL_FAILED_NO_MATCHING_ABIS"},
		{`not json`, contract.StateBooting, ""},
	}
	for _, tt := range tests {
		status.Store(tt.body)
		got, err := p.Get(t.Context(), s.ID)
		if err != nil || got.State != tt.want || got.Reason != tt.wantReason {
			t.Fatalf("agent %s: session %+v, %v", tt.body, got, err)
		}
		list, err := p.List(t.Context())
		if err != nil || len(list) != 1 || list[0].State != tt.want {
			t.Fatalf("agent %s: list %+v, %v", tt.body, list, err)
		}
	}
}

func TestPendingDetail(t *testing.T) {
	waiting := func(reason string) corev1.PodStatus {
		return corev1.PodStatus{Phase: corev1.PodPending, ContainerStatuses: []corev1.ContainerStatus{
			{Name: "emulator", Image: "session:abc", State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: reason, Message: "boom"}}},
		}}
	}
	tests := []struct {
		status corev1.PodStatus
		want   string
	}{
		{corev1.PodStatus{Phase: corev1.PodPending}, ""},
		{corev1.PodStatus{Phase: corev1.PodPending, Conditions: []corev1.PodCondition{
			{Type: corev1.PodScheduled, Status: corev1.ConditionFalse, Message: "0/4 nodes are available"},
		}}, "Waiting for the node: 0/4 nodes are available"},
		{waiting("ContainerCreating"), "Starting the device container"},
		{waiting("ImagePullBackOff"), "The session image session:abc can't be pulled yet, retrying (a new build may still be publishing it)"},
		{waiting("CreateContainerConfigError"), "CreateContainerConfigError: boom"},
	}
	for _, tt := range tests {
		if got := pending(corev1.Pod{Status: tt.status}); got != tt.want {
			t.Errorf("%+v: detail %q, want %q", tt.status, got, tt.want)
		}
	}
}

func TestGracePeriod(t *testing.T) {
	running := corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}
	pulling := corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ContainerCreating"}}
	for _, tc := range []struct {
		name     string
		statuses []corev1.ContainerStatus
		force    bool
	}{
		{"scheduled", nil, true},
		{"pulling the image", []corev1.ContainerStatus{{Name: "emulator", State: pulling}, {Name: "vpn", State: pulling}}, true},
		{"sidecar running", []corev1.ContainerStatus{{Name: "emulator", State: pulling}, {Name: "vpn", State: running}}, false},
		{"emulator running", []corev1.ContainerStatus{{Name: "emulator", State: running}}, false},
	} {
		got := gracePeriod(corev1.Pod{Status: corev1.PodStatus{ContainerStatuses: tc.statuses}})
		if force := got != nil && *got == 0; force != tc.force {
			t.Errorf("%s: grace period %v", tc.name, got)
		}
	}
}

func TestInstall(t *testing.T) {
	var got atomic.Value
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/install" {
			http.NotFound(w, r)
			return
		}
		var in contract.Install
		_ = json.NewDecoder(r.Body).Decode(&in)
		got.Store(in)
		if strings.Contains(in.ArtifactRef, "broken") {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"detail":"invalid request: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]"}`))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(agent.Close)
	port, _ := strconv.Atoi(agent.URL[strings.LastIndex(agent.URL, ":")+1:])

	kube := cluster()
	p := newProvider(t, kube, func(c *Config) { c.AgentPort = port })
	p.agents = agent.Client()
	s, err := p.Create(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	next := contract.Install{ArtifactURL: "http://api/internal/artifacts/v2", ArtifactRef: "local/app-v2.apk@2", KeepData: true}
	if _, err := p.Install(t.Context(), s.ID, next); !errors.Is(err, contract.ErrInvalid) {
		t.Fatalf("install before ready: %v", err)
	}

	setStatus(t, kube, s.ID, corev1.PodStatus{Phase: corev1.PodRunning, PodIP: "127.0.0.1", ContainerStatuses: []corev1.ContainerStatus{
		{Name: "emulator", Ready: true, State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}},
		{Name: "vpn", Ready: true, State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}},
	}})
	updated, err := p.Install(t.Context(), s.ID, next)
	if err != nil || updated.ArtifactRef != next.ArtifactRef || got.Load().(contract.Install) != next {
		t.Fatalf("install %+v, %v, agent got %+v", updated, err, got.Load())
	}

	_, err = p.Install(t.Context(), s.ID, contract.Install{ArtifactURL: "http://api/x", ArtifactRef: "local/broken.apk@1"})
	if !errors.Is(err, contract.ErrInvalid) || !strings.Contains(err.Error(), "INSTALL_FAILED_UPDATE_INCOMPATIBLE") {
		t.Fatalf("broken install: %v", err)
	}
	if again, _ := p.Get(t.Context(), s.ID); again.ArtifactRef != next.ArtifactRef {
		t.Fatalf("a failed install must keep the recorded build: %s", again.ArtifactRef)
	}
}
