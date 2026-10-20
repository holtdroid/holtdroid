// Package emulator is the device provider that runs every session as a Pod
// with a redroid container (Android on the node's kernel) and the agent, a
// few to a node. Session state lives in the Pod's labels and annotations.
package emulator

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/go-logr/logr"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/telemetry"
	"github.com/holtdroid/holtdroid/internal/vpn"
)

type Config struct {
	Listen       string
	Kubeconfig   string
	Namespace    string
	Slots        int
	SlotsPerNode int
	NodeSelector string
	Tolerations  []Toleration
	// Image is the session image with the agent; Android runs from Redroid.
	Image            string
	ImagePullPolicy  string
	ImagePullSecrets []string
	AgentPort        int
	TunnelPort       int
	Redroid          Redroid
	Resources        Resources
	AgentResources   Resources
	Nodes            map[string]Node
	VPN              vpn.Config
	Prepull          Prepull
	SessionTelemetry SessionTelemetry
	Maintenance      string
	NodeInfo         NodeInfo
}

// NodeInfo finds the node-info Pods that describe session nodes: a label
// selector in the provider's namespace and their port.
type NodeInfo struct {
	Selector string
	Port     int
}

// SessionTelemetry is what session agents get of the telemetry settings.
type SessionTelemetry struct {
	MetricsPort int
	Tracing     telemetry.TracingConfig
}

type Toleration struct {
	Key      string
	Operator string
	Value    string
	Effect   string
}

// Node overrides the session settings on one node, by name.
type Node struct {
	Slots     int
	Resources Resources
}

// Redroid is the Android container: its image and boot settings. The screen
// size is fixed at boot; GPU is the node's DRI render node.
type Redroid struct {
	Image    string
	Width    int
	Height   int
	DPI      int
	FPS      int
	GPU      string
	DataSize string
	Args     []string
}

type Resources struct {
	Requests map[string]string
	Limits   map[string]string
}

func DefaultConfig() Config {
	return Config{
		Listen:          ":8080",
		Namespace:       "holtdroid",
		SlotsPerNode:    1,
		Image:           "ghcr.io/holtdroid/holtdroid-session:main",
		ImagePullPolicy: string(corev1.PullIfNotPresent),
		AgentPort:       8080,
		TunnelPort:      8081,
		Redroid: Redroid{
			Image:    "ghcr.io/holtdroid/holtdroid-redroid:main",
			Width:    720,
			Height:   1600,
			DPI:      320,
			FPS:      60,
			GPU:      "/dev/dri/renderD128",
			DataSize: "8Gi",
		},
		Resources: Resources{
			Requests: map[string]string{"cpu": "1", "memory": "1536Mi"},
			Limits:   map[string]string{"memory": "3Gi"},
		},
		AgentResources: Resources{
			Requests: map[string]string{"cpu": "100m", "memory": "256Mi"},
			Limits:   map[string]string{"memory": "1Gi"},
		},
		VPN:         vpn.DefaultConfig(),
		Prepull:     Prepull{Refresh: true, Interval: 5 * time.Minute},
		Maintenance: "holtdroid-emulator-maintenance",
		NodeInfo:    NodeInfo{Port: 8090},
	}
}

func (c Config) Validate() error {
	var errs []error
	if c.Namespace == "" {
		errs = append(errs, errors.New("namespace is required"))
	}
	if c.Image == "" || c.Redroid.Image == "" {
		errs = append(errs, errors.New("image and redroid.image are required"))
	}
	if c.Slots < 0 || c.SlotsPerNode < 0 {
		errs = append(errs, errors.New("slots and slotsPerNode must not be negative"))
	}
	if r := c.Redroid; r.Width <= 0 || r.Height <= 0 || r.DPI <= 0 || r.FPS <= 0 {
		errs = append(errs, errors.New("redroid: width, height, dpi and fps must be positive"))
	}
	if c.Redroid.DataSize != "" {
		if _, err := resource.ParseQuantity(c.Redroid.DataSize); err != nil {
			errs = append(errs, fmt.Errorf("redroid.dataSize: %w", err))
		}
	}
	if c.AgentPort <= 0 || c.AgentPort > 65535 {
		errs = append(errs, fmt.Errorf("agentPort %d is not a port", c.AgentPort))
	}
	if c.TunnelPort <= 0 || c.TunnelPort > 65535 || c.TunnelPort == c.AgentPort {
		errs = append(errs, fmt.Errorf("tunnelPort %d is not a port other than agentPort", c.TunnelPort))
	}
	if p := c.SessionTelemetry.MetricsPort; p < 0 || p > 65535 || (p != 0 && (p == c.AgentPort || p == c.TunnelPort)) {
		errs = append(errs, fmt.Errorf("sessionTelemetry.metricsPort %d is not a free port", p))
	}
	switch corev1.PullPolicy(c.ImagePullPolicy) {
	case corev1.PullAlways, corev1.PullIfNotPresent, corev1.PullNever:
	default:
		errs = append(errs, fmt.Errorf("imagePullPolicy %q must be Always, IfNotPresent or Never", c.ImagePullPolicy))
	}
	if _, err := labels.Parse(c.NodeSelector); err != nil {
		errs = append(errs, fmt.Errorf("nodeSelector: %w", err))
	}
	if _, err := labels.Parse(c.NodeInfo.Selector); err != nil {
		errs = append(errs, fmt.Errorf("nodeInfo.selector: %w", err))
	}
	if c.NodeInfo.Selector != "" && (c.NodeInfo.Port <= 0 || c.NodeInfo.Port > 65535) {
		errs = append(errs, fmt.Errorf("nodeInfo.port %d is not a port", c.NodeInfo.Port))
	}
	if _, err := c.Resources.requirements(); err != nil {
		errs = append(errs, err)
	}
	if _, err := c.AgentResources.requirements(); err != nil {
		errs = append(errs, fmt.Errorf("agentResources: %w", err))
	}
	for name, n := range c.Nodes {
		if n.Slots < 0 {
			errs = append(errs, fmt.Errorf("nodes.%s: slots must not be negative", name))
		}
		if _, err := n.Resources.requirements(); err != nil {
			errs = append(errs, fmt.Errorf("nodes.%s: %w", name, err))
		}
	}
	if err := c.VPN.Validate(); err != nil {
		errs = append(errs, err)
	}
	if c.Prepull.Refresh && c.Prepull.DaemonSet != "" && c.Prepull.Interval < 30*time.Second {
		errs = append(errs, fmt.Errorf("prepull.interval %s is shorter than 30s", c.Prepull.Interval))
	}
	return errors.Join(errs...)
}

func (r Resources) requirements() (corev1.ResourceRequirements, error) {
	parse := func(name string, in map[string]string) (corev1.ResourceList, error) {
		if len(in) == 0 {
			return nil, nil
		}
		out := corev1.ResourceList{}
		for k, v := range in {
			q, err := resource.ParseQuantity(v)
			if err != nil {
				return nil, fmt.Errorf("resources.%s.%s: %w", name, k, err)
			}
			out[corev1.ResourceName(k)] = q
		}
		return out, nil
	}
	requests, err := parse("requests", r.Requests)
	if err != nil {
		return corev1.ResourceRequirements{}, err
	}
	limits, err := parse("limits", r.Limits)
	return corev1.ResourceRequirements{Requests: requests, Limits: limits}, err
}

// Client builds a Kubernetes client from cfg.Kubeconfig, or from the Pod's
// service account when it is empty.
func Client(cfg Config) (kubernetes.Interface, error) {
	var rc *rest.Config
	var err error
	if cfg.Kubeconfig != "" {
		rc, err = clientcmd.BuildConfigFromFlags("", cfg.Kubeconfig)
	} else {
		rc, err = rest.InClusterConfig()
	}
	if err != nil {
		return nil, err
	}
	rc.QPS, rc.Burst = 50, 100
	return kubernetes.NewForConfig(rc)
}

type Provider struct {
	cfg       Config
	kube      kubernetes.Interface
	secrets   vpn.Secrets
	now       func() time.Time
	resources corev1.ResourceRequirements
	agentRes  corev1.ResourceRequirements
	nodeRes   map[string]corev1.ResourceRequirements
	selector  labels.Selector
	nodeInfo  labels.Selector
	agents    *http.Client
	registry  *registry
	log       *slog.Logger

	mu sync.Mutex
}

type Option func(*Provider)

func WithClock(now func() time.Time) Option { return func(p *Provider) { p.now = now } }

func New(cfg Config, kube kubernetes.Interface, sec vpn.Secrets, opts ...Option) (*Provider, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	res, _ := cfg.Resources.requirements()
	agentRes, _ := cfg.AgentResources.requirements()
	nodeRes := map[string]corev1.ResourceRequirements{}
	for name, n := range cfg.Nodes {
		if len(n.Resources.Requests)+len(n.Resources.Limits) > 0 {
			nodeRes[name], _ = n.Resources.requirements()
		}
	}
	sel, _ := labels.Parse(cfg.NodeSelector)
	nodeInfo, _ := labels.Parse(cfg.NodeInfo.Selector)
	p := &Provider{cfg: cfg, kube: kube, secrets: sec, now: time.Now, resources: res, agentRes: agentRes, nodeRes: nodeRes, selector: sel, nodeInfo: nodeInfo, agents: &http.Client{Timeout: 2 * time.Second}, registry: newRegistry(), log: slog.Default()}
	for _, opt := range opts {
		opt(p)
	}
	return p, nil
}

func (p *Provider) Capabilities(context.Context) (contract.Capabilities, error) {
	return contract.Capabilities{
		Kind:            "emulator",
		Display:         contract.DisplayScrcpy,
		DevTools:        true,
		Clipboard:       true,
		Locations:       p.cfg.VPN.Offered(),
		DefaultLocation: p.cfg.VPN.DefaultLocation(),
		ABIs:            []string{"x86_64", "arm64-v8a"},
	}, nil
}

func (p *Provider) Capacity(ctx context.Context) (contract.Capacity, error) {
	c, err := p.capacity(ctx)
	return c.Capacity, err
}

type snapshot struct {
	contract.Capacity
	pods []corev1.Pod
	// nodes holds the node of each slot, in the order of Slots.
	nodes []corev1.Node
}

func (p *Provider) capacity(ctx context.Context) (snapshot, error) {
	nodes, err := p.kube.CoreV1().Nodes().List(ctx, metav1.ListOptions{LabelSelector: p.selector.String()})
	if err != nil {
		return snapshot{}, fmt.Errorf("list nodes: %w", err)
	}
	pods, err := p.pods(ctx)
	if err != nil {
		return snapshot{}, err
	}
	held, err := p.maintenance(ctx)
	if err != nil {
		return snapshot{}, err
	}
	busy := map[string]bool{}
	for _, pod := range pods {
		busy[pod.Labels[labelSlot]] = true
	}
	eligible := slices.DeleteFunc(nodes.Items, func(n corev1.Node) bool { return !p.tolerates(n) })
	slices.SortFunc(eligible, func(a, b corev1.Node) int { return cmp.Compare(a.Name, b.Name) })
	c := contract.Capacity{Slots: []contract.Slot{}}
	var slotNodes []corev1.Node
	for _, n := range eligible {
		for i := range p.slotsOn(n.Name) {
			if p.cfg.Slots > 0 && len(c.Slots) == p.cfg.Slots {
				break
			}
			id := slotID(n.Name, i+1)
			state := contract.SlotFree
			switch {
			case busy[id]:
				state = contract.SlotBusy
			case n.Spec.Unschedulable || !nodeReady(n):
				state = contract.SlotOffline
			}
			c.Slots = append(c.Slots, contract.Slot{ID: id, Label: id, State: state})
			slotNodes = append(slotNodes, n)
		}
	}
	held.Apply(&c)
	return snapshot{c, pods, slotNodes}, nil
}

func (p *Provider) slotsOn(node string) int {
	if n := p.cfg.Nodes[node].Slots; n > 0 {
		return n
	}
	return p.cfg.SlotsPerNode
}

func slotID(node string, i int) string { return node + "-" + strconv.Itoa(i) }

func (p *Provider) tolerates(n corev1.Node) bool {
	tolerations := p.tolerations()
	for _, taint := range n.Spec.Taints {
		if taint.Effect == corev1.TaintEffectPreferNoSchedule {
			continue
		}
		if !slices.ContainsFunc(tolerations, func(t corev1.Toleration) bool { return t.ToleratesTaint(logr.Discard(), &taint, false) }) {
			return false
		}
	}
	return true
}

func nodeReady(n corev1.Node) bool {
	for _, c := range n.Status.Conditions {
		if c.Type == corev1.NodeReady {
			return c.Status == corev1.ConditionTrue
		}
	}
	return false
}

func (p *Provider) pods(ctx context.Context) ([]corev1.Pod, error) {
	list, err := p.kube.CoreV1().Pods(p.cfg.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labels.SelectorFromSet(podSelector).String(),
	})
	if err != nil {
		return nil, fmt.Errorf("list session pods: %w", err)
	}
	return list.Items, nil
}

func (p *Provider) List(ctx context.Context) ([]contract.Session, error) {
	pods, err := p.pods(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]contract.Session, len(pods))
	var wg sync.WaitGroup
	for i, pod := range pods {
		wg.Go(func() { out[i] = p.session(ctx, pod) })
	}
	wg.Wait()
	slices.SortFunc(out, func(a, b contract.Session) int { return a.CreatedAt.Compare(b.CreatedAt) })
	return out, nil
}

func (p *Provider) Create(ctx context.Context, req contract.CreateSession) (contract.Session, error) {
	var location string
	var vpnConfig []byte
	switch {
	case p.cfg.VPN.Enabled():
		location = cmp.Or(req.Location, p.cfg.VPN.DefaultLocation())
		var err error
		if vpnConfig, err = p.cfg.VPN.Render(ctx, p.secrets, location); err != nil {
			return contract.Session{}, err
		}
	case req.Location != "":
		return contract.Session{}, fmt.Errorf("%w: unknown location %q", contract.ErrInvalid, req.Location)
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	c, err := p.capacity(ctx)
	if err != nil {
		return contract.Session{}, err
	}
	i, err := c.Pick(req.Slot)
	if err != nil {
		return contract.Session{}, err
	}

	pod := p.renderPod(randomID(), c.Slots[i].ID, c.nodes[i].Name, req, location, p.now())
	created, err := p.kube.CoreV1().Pods(p.cfg.Namespace).Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		return contract.Session{}, fmt.Errorf("create session pod: %w", err)
	}
	if vpnConfig != nil {
		if _, err := p.kube.CoreV1().Secrets(p.cfg.Namespace).Create(ctx, renderSecret(created, vpnConfig), metav1.CreateOptions{}); err != nil {
			_ = p.kube.CoreV1().Pods(p.cfg.Namespace).Delete(context.WithoutCancel(ctx), created.Name, metav1.DeleteOptions{})
			return contract.Session{}, fmt.Errorf("create session secret: %w", err)
		}
	}
	return p.podSession(*created), nil
}

// session asks the agent of a running but not yet ready Pod for its stage,
// so installing, instrumenting and a failure after boot show up in listings.
func (p *Provider) session(ctx context.Context, pod corev1.Pod) contract.Session {
	s := p.podSession(pod)
	if s.State != contract.StateBooting || s.AgentURL == "" {
		return s
	}
	ev, err := contract.NewAgentClient(s.AgentURL, p.agents).Status(ctx)
	if err != nil || ev.State == "" {
		return s
	}
	s.State = ev.State
	if ev.State == contract.StateFailed {
		s.Reason = cmp.Or(ev.Reason, ev.Detail)
	}
	return s
}

func (p *Provider) pod(ctx context.Context, id string) (*corev1.Pod, error) {
	pod, err := p.kube.CoreV1().Pods(p.cfg.Namespace).Get(ctx, podName(id), metav1.GetOptions{})
	if apierrors.IsNotFound(err) || err == nil && pod.Labels[labelSession] != id {
		return nil, fmt.Errorf("%w: session %s", contract.ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("get session pod: %w", err)
	}
	return pod, nil
}

func (p *Provider) Get(ctx context.Context, id string) (contract.Session, error) {
	pod, err := p.pod(ctx, id)
	if err != nil {
		return contract.Session{}, err
	}
	return p.session(ctx, *pod), nil
}

func (p *Provider) Delete(ctx context.Context, id string) error {
	pod, err := p.pod(ctx, id)
	if err != nil {
		return err
	}
	err = p.kube.CoreV1().Pods(p.cfg.Namespace).Delete(ctx, podName(id), metav1.DeleteOptions{GracePeriodSeconds: gracePeriod(*pod)})
	if apierrors.IsNotFound(err) {
		return fmt.Errorf("%w: session %s", contract.ErrNotFound, id)
	}
	return err
}

func (p *Provider) Touch(ctx context.Context, id string, at time.Time) error {
	if _, err := p.pod(ctx, id); err != nil {
		return err
	}
	patch := fmt.Appendf(nil, `{"metadata":{"annotations":{%q:%q}}}`, annotationLastActivity, at.UTC().Format(time.RFC3339Nano))
	_, err := p.kube.CoreV1().Pods(p.cfg.Namespace).Patch(ctx, podName(id), types.MergePatchType, patch, metav1.PatchOptions{})
	if apierrors.IsNotFound(err) {
		return fmt.Errorf("%w: session %s", contract.ErrNotFound, id)
	}
	return err
}

// Install hands another build to the session's agent and, once it runs,
// records it on the Pod as the session's artifact.
func (p *Provider) Install(ctx context.Context, id string, req contract.Install) (contract.Session, error) {
	pod, err := p.pod(ctx, id)
	if err != nil {
		return contract.Session{}, err
	}
	s := p.podSession(*pod)
	if s.State != contract.StateReady || s.AgentURL == "" {
		return contract.Session{}, fmt.Errorf("%w: session %s is not ready", contract.ErrInvalid, id)
	}
	if err := contract.NewAgentClient(s.AgentURL, p.agents).Install(ctx, req); err != nil {
		return contract.Session{}, err
	}
	patch := fmt.Appendf(nil, `{"metadata":{"annotations":{%q:%q}}}`, annotationArtifactRef, req.ArtifactRef)
	updated, err := p.kube.CoreV1().Pods(p.cfg.Namespace).Patch(context.WithoutCancel(ctx), podName(id), types.MergePatchType, patch, metav1.PatchOptions{})
	if err != nil {
		return contract.Session{}, fmt.Errorf("record the installed build: %w", err)
	}
	return p.podSession(*updated), nil
}

func randomID() string {
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
