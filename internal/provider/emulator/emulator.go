// Package emulator is the device provider that runs every session as an
// Android emulator Pod on a KVM-capable Kubernetes node. Session state lives
// in the Pod's labels and annotations.
package emulator

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"slices"
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

	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/vpn"
)

type Config struct {
	Listen           string
	Kubeconfig       string
	Namespace        string
	Slots            int
	NodeSelector     string
	Tolerations      []Toleration
	Image            string
	ImagePullPolicy  string
	ImagePullSecrets []string
	AgentPort        int
	Resources        Resources
	VPN              vpn.Config
}

type Toleration struct {
	Key      string
	Operator string
	Value    string
	Effect   string
}

type Resources struct {
	Requests map[string]string
	Limits   map[string]string
}

func DefaultConfig() Config {
	return Config{
		Listen:          ":8080",
		Namespace:       "holtdroid",
		Slots:           4,
		Image:           "ghcr.io/kriakiku/holtdroid-session:main",
		ImagePullPolicy: string(corev1.PullIfNotPresent),
		AgentPort:       8080,
		Resources: Resources{
			Requests: map[string]string{"cpu": "3", "memory": "5Gi"},
			Limits:   map[string]string{"cpu": "4", "memory": "7Gi"},
		},
		VPN: vpn.DefaultConfig(),
	}
}

func (c Config) Validate() error {
	var errs []error
	if c.Namespace == "" {
		errs = append(errs, errors.New("namespace is required"))
	}
	if c.Image == "" {
		errs = append(errs, errors.New("image is required"))
	}
	if c.Slots < 0 {
		errs = append(errs, errors.New("slots must not be negative"))
	}
	if c.AgentPort <= 0 || c.AgentPort > 65535 {
		errs = append(errs, fmt.Errorf("agentPort %d is not a port", c.AgentPort))
	}
	switch corev1.PullPolicy(c.ImagePullPolicy) {
	case corev1.PullAlways, corev1.PullIfNotPresent, corev1.PullNever:
	default:
		errs = append(errs, fmt.Errorf("imagePullPolicy %q must be Always, IfNotPresent or Never", c.ImagePullPolicy))
	}
	if _, err := labels.Parse(c.NodeSelector); err != nil {
		errs = append(errs, fmt.Errorf("nodeSelector: %w", err))
	}
	if _, err := c.Resources.requirements(); err != nil {
		errs = append(errs, err)
	}
	if err := c.VPN.Validate(); err != nil {
		errs = append(errs, err)
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
	return kubernetes.NewForConfig(rc)
}

type Provider struct {
	cfg       Config
	kube      kubernetes.Interface
	secrets   vpn.Secrets
	now       func() time.Time
	resources corev1.ResourceRequirements
	selector  labels.Selector
	agents    *http.Client

	mu sync.Mutex
}

type Option func(*Provider)

func WithClock(now func() time.Time) Option { return func(p *Provider) { p.now = now } }

func New(cfg Config, kube kubernetes.Interface, sec vpn.Secrets, opts ...Option) (*Provider, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	res, _ := cfg.Resources.requirements()
	sel, _ := labels.Parse(cfg.NodeSelector)
	p := &Provider{cfg: cfg, kube: kube, secrets: sec, now: time.Now, resources: res, selector: sel, agents: &http.Client{Timeout: 2 * time.Second}}
	for _, opt := range opts {
		opt(p)
	}
	return p, nil
}

func (p *Provider) Capabilities(context.Context) (contract.Capabilities, error) {
	return contract.Capabilities{
		Kind:            "emulator",
		Display:         contract.DisplayNoVNC,
		DevTools:        true,
		Clipboard:       true,
		Locations:       p.cfg.VPN.Offered(),
		DefaultLocation: p.cfg.VPN.DefaultLocation(),
		ABIs:            []string{"x86_64", "arm64-v8a"},
	}, nil
}

func (p *Provider) Capacity(ctx context.Context) (contract.Capacity, error) {
	c, _, err := p.capacity(ctx)
	return c, err
}

func (p *Provider) capacity(ctx context.Context) (contract.Capacity, []corev1.Pod, error) {
	nodes, err := p.kube.CoreV1().Nodes().List(ctx, metav1.ListOptions{LabelSelector: p.selector.String()})
	if err != nil {
		return contract.Capacity{}, nil, fmt.Errorf("list nodes: %w", err)
	}
	pods, err := p.pods(ctx)
	if err != nil {
		return contract.Capacity{}, nil, err
	}
	busy := map[string]bool{}
	for _, pod := range pods {
		busy[pod.Labels[labelSlot]] = true
	}
	eligible := slices.DeleteFunc(nodes.Items, func(n corev1.Node) bool { return !p.tolerates(n) })
	slices.SortFunc(eligible, func(a, b corev1.Node) int { return cmp.Compare(a.Name, b.Name) })
	if p.cfg.Slots > 0 && len(eligible) > p.cfg.Slots {
		eligible = eligible[:p.cfg.Slots]
	}
	c := contract.Capacity{Slots: []contract.Slot{}}
	for _, n := range eligible {
		state := contract.SlotFree
		switch {
		case busy[n.Name]:
			state = contract.SlotBusy
		case n.Spec.Unschedulable || !nodeReady(n):
			state = contract.SlotOffline
		}
		c.Slots = append(c.Slots, contract.Slot{ID: n.Name, Label: n.Name, State: state})
	}
	return c, pods, nil
}

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
	c, _, err := p.capacity(ctx)
	if err != nil {
		return contract.Session{}, err
	}
	i := slices.IndexFunc(c.Slots, func(s contract.Slot) bool { return s.State == contract.SlotFree })
	if i < 0 {
		return contract.Session{}, contract.ErrNoCapacity
	}

	pod := p.renderPod(randomID(), c.Slots[i].ID, req, location, p.now())
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

func randomID() string {
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
