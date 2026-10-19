package emulator

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"sync"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/util/retry"

	"github.com/kriakiku/holtdroid/internal/contract"
)

const maintenanceKey = "maintenance.json"

func (p *Provider) maintenance(ctx context.Context) (contract.MaintenanceState, error) {
	var st contract.MaintenanceState
	if p.cfg.Maintenance == "" {
		return st, nil
	}
	cm, err := p.kube.CoreV1().ConfigMaps(p.cfg.Namespace).Get(ctx, p.cfg.Maintenance, metav1.GetOptions{})
	switch {
	case apierrors.IsNotFound(err):
		return st, nil
	case err != nil:
		return st, fmt.Errorf("read maintenance: %w", err)
	}
	if data := cm.Data[maintenanceKey]; data != "" {
		if err := json.Unmarshal([]byte(data), &st); err != nil {
			return st, fmt.Errorf("read maintenance from configmap %s: %w", cm.Name, err)
		}
	}
	return st, nil
}

func (p *Provider) SetMaintenance(ctx context.Context, req contract.SetMaintenance) error {
	if p.cfg.Maintenance == "" {
		return fmt.Errorf("%w: maintenance is off: the provider has no configmap for it", contract.ErrInvalid)
	}
	if req.Slot != "" {
		c, err := p.capacity(ctx)
		if err != nil {
			return err
		}
		if _, ok := c.slot(req.Slot); !ok {
			return fmt.Errorf("%w: unknown slot %q", contract.ErrInvalid, req.Slot)
		}
	}
	configMaps := p.kube.CoreV1().ConfigMaps(p.cfg.Namespace)
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		cm, err := configMaps.Get(ctx, p.cfg.Maintenance, metav1.GetOptions{})
		create := apierrors.IsNotFound(err)
		if create {
			cm = &corev1.ConfigMap{Name: p.cfg.Maintenance, Labels: map[string]string{"app.kubernetes.io/managed-by": "holtdroid-provider-emulator"}}
		} else if err != nil {
			return fmt.Errorf("read maintenance: %w", err)
		}
		var st contract.MaintenanceState
		if data := cm.Data[maintenanceKey]; data != "" {
			if err := json.Unmarshal([]byte(data), &st); err != nil {
				return fmt.Errorf("read maintenance from configmap %s: %w", cm.Name, err)
			}
		}
		st.Set(req, p.now())
		b, err := json.Marshal(st)
		if err != nil {
			return err
		}
		if cm.Data == nil {
			cm.Data = map[string]string{}
		}
		cm.Data[maintenanceKey] = string(b)
		if create {
			_, err = configMaps.Create(ctx, cm, metav1.CreateOptions{})
		} else {
			_, err = configMaps.Update(ctx, cm, metav1.UpdateOptions{})
		}
		switch {
		case apierrors.IsAlreadyExists(err):
			return apierrors.NewConflict(corev1.Resource("configmaps"), cm.Name, err)
		case err != nil && !apierrors.IsConflict(err):
			return fmt.Errorf("save maintenance: %w", err)
		}
		return err
	})
}

func (s snapshot) slot(id string) (contract.Slot, bool) {
	for _, sl := range s.Slots {
		if sl.ID == id {
			return sl, true
		}
	}
	return contract.Slot{}, false
}

// Inventory describes every session node from its Node object and, where a
// node-info Pod runs on it, from the node itself: CPU, load and sensors.
func (p *Provider) Inventory(ctx context.Context) (contract.Inventory, error) {
	c, err := p.capacity(ctx)
	if err != nil {
		return contract.Inventory{}, err
	}
	sessions := map[string]string{}
	for _, pod := range c.pods {
		sessions[pod.Labels[labelSlot]] = pod.Labels[labelSession]
	}
	urls, urlErr := p.nodeInfoURLs(ctx)
	inv := contract.Inventory{Maintenance: c.Maintenance, Devices: make([]contract.InventoryDevice, len(c.Slots))}
	var wg sync.WaitGroup
	for i, slot := range c.Slots {
		d := &inv.Devices[i]
		d.Slot, d.Session = slot, sessions[slot.ID]
		host := nodeHost(c.nodes[i])
		d.Host = &host
		switch url, ok := urls[slot.ID]; {
		case p.cfg.NodeInfo.Selector == "":
		case urlErr != nil:
			d.Error = urlErr.Error()
		case !ok:
			d.Error = "node-info: no running pod on this node"
		default:
			wg.Go(func() {
				live, err := contract.NewNodeClient(url, p.agents).Host(ctx)
				if err != nil {
					d.Error = fmt.Sprintf("node-info: %v", err)
					return
				}
				mergeHost(d.Host, live)
			})
		}
	}
	wg.Wait()
	return inv, nil
}

func (p *Provider) nodeInfoURLs(ctx context.Context) (map[string]string, error) {
	if p.cfg.NodeInfo.Selector == "" {
		return nil, nil
	}
	pods, err := p.kube.CoreV1().Pods(p.cfg.Namespace).List(ctx, metav1.ListOptions{LabelSelector: p.nodeInfo.String()})
	if err != nil {
		return nil, fmt.Errorf("node-info: list pods: %w", err)
	}
	urls := map[string]string{}
	for _, pod := range pods.Items {
		if pod.Status.Phase == corev1.PodRunning && pod.Status.PodIP != "" && pod.Spec.NodeName != "" {
			urls[pod.Spec.NodeName] = "http://" + net.JoinHostPort(pod.Status.PodIP, strconv.Itoa(p.cfg.NodeInfo.Port))
		}
	}
	return urls, nil
}

func nodeHost(n corev1.Node) contract.HostInfo {
	ni := n.Status.NodeInfo
	h := contract.HostInfo{
		Hostname:    n.Name,
		OS:          ni.OSImage,
		Kernel:      ni.KernelVersion,
		Arch:        ni.Architecture,
		Runtime:     ni.ContainerRuntimeVersion,
		Kubelet:     ni.KubeletVersion,
		Cores:       int(n.Status.Capacity.Cpu().Value()),
		MemoryTotal: n.Status.Capacity.Memory().Value(),
		Conditions:  []string{},
		Thermal:     []contract.Temperature{},
	}
	for _, c := range n.Status.Conditions {
		switch {
		case c.Type == corev1.NodeReady && c.Status != corev1.ConditionTrue:
			h.Conditions = append(h.Conditions, "NotReady")
		case c.Type != corev1.NodeReady && c.Status == corev1.ConditionTrue:
			h.Conditions = append(h.Conditions, string(c.Type))
		}
	}
	if n.Spec.Unschedulable {
		h.Conditions = append(h.Conditions, "Unschedulable")
	}
	return h
}

func mergeHost(h *contract.HostInfo, live contract.HostInfo) {
	h.Kernel = cmp.Or(h.Kernel, live.Kernel)
	h.Arch = cmp.Or(h.Arch, live.Arch)
	h.CPU = live.CPU
	h.Cores = cmp.Or(live.Cores, h.Cores)
	h.MemoryTotal = cmp.Or(live.MemoryTotal, h.MemoryTotal)
	h.MemoryAvailable = live.MemoryAvailable
	h.Load1, h.Load5, h.Load15 = live.Load1, live.Load5, live.Load15
	h.Uptime = live.Uptime
	if live.Thermal != nil {
		h.Thermal = live.Thermal
	}
}
