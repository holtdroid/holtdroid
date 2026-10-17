package emulator

import (
	"cmp"
	"fmt"
	"maps"
	"net"
	"strconv"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/vpn"
)

const (
	labelSession = "holtdroid/session"
	labelSlot    = "holtdroid/slot"

	annotationOwner        = "holtdroid/owner"
	annotationPackage      = "holtdroid/package"
	annotationArtifactRef  = "holtdroid/artifact-ref"
	annotationLocation     = "holtdroid/location"
	annotationCreatedAt    = "holtdroid/created-at"
	annotationLastActivity = "holtdroid/last-activity"

	containerEmulator = "emulator"
	containerVPN      = "vpn"
	vpnConfigKey      = "config.json"
	hostnameLabel     = "kubernetes.io/hostname"
)

var podSelector = map[string]string{
	"app.kubernetes.io/name":       "holtdroid-session",
	"app.kubernetes.io/managed-by": "holtdroid-provider-emulator",
}

func podName(id string) string { return "holtdroid-session-" + id }

func sessionLabels(id, slot string) map[string]string {
	l := map[string]string{labelSession: id, labelSlot: slot}
	maps.Copy(l, podSelector)
	return l
}

func (p *Provider) tolerations() []corev1.Toleration {
	out := make([]corev1.Toleration, 0, len(p.cfg.Tolerations))
	for _, t := range p.cfg.Tolerations {
		out = append(out, corev1.Toleration{
			Key:      t.Key,
			Operator: corev1.TolerationOperator(t.Operator),
			Value:    t.Value,
			Effect:   corev1.TaintEffect(t.Effect),
		})
	}
	return out
}

func (p *Provider) renderPod(id, slot string, req contract.CreateSession, location string, now time.Time) *corev1.Pod {
	name := podName(id)
	at := now.UTC().Format(time.RFC3339Nano)
	hostPath := func(path string) corev1.VolumeSource {
		return corev1.VolumeSource{HostPath: &corev1.HostPathVolumeSource{Path: path, Type: new(corev1.HostPathCharDev)}}
	}

	env := []corev1.EnvVar{
		{Name: "HOLTDROID_LISTEN", Value: ":" + strconv.Itoa(p.cfg.AgentPort)},
		{Name: "HOLTDROID_TUNNELLISTEN", Value: ":" + strconv.Itoa(p.cfg.TunnelPort)},
		{Name: "HOLTDROID_ARTIFACTURL", Value: req.ArtifactURL},
		{Name: "HOLTDROID_PACKAGE", Value: req.Package},
		{Name: "HOLTDROID_SESSION__ID", Value: id},
		{Name: "HOLTDROID_SESSION__OWNER", Value: req.Owner},
		{Name: "HOLTDROID_SESSION__ARTIFACTREF", Value: req.ArtifactRef},
		{Name: "HOLTDROID_SESSION__SLOT", Value: slot},
		{Name: "HOLTDROID_SESSION__CREATEDAT", Value: at},
	}
	if location != "" {
		env = append(env, corev1.EnvVar{Name: "HOLTDROID_LOCATION", Value: location})
	}
	volumes := []corev1.Volume{
		{Name: "kvm", VolumeSource: hostPath("/dev/kvm")},
		{Name: "shm", EmptyDir: &corev1.EmptyDirVolumeSource{Medium: corev1.StorageMediumMemory}},
	}
	if p.cfg.VPN.Enabled() {
		env = append(env,
			corev1.EnvVar{Name: "HOLTDROID_CLASHAPI", Value: "http://" + vpn.ClashAPI},
			corev1.EnvVar{Name: "HOLTDROID_EMULATOR__DNSSERVER", Value: p.cfg.VPN.DNS},
		)
		volumes = append(volumes,
			corev1.Volume{Name: "tun", VolumeSource: hostPath("/dev/net/tun")},
			corev1.Volume{Name: "vpn-config", Secret: &corev1.SecretVolumeSource{SecretName: name}},
		)
	}

	containers := []corev1.Container{{
		Name:            containerEmulator,
		Image:           p.cfg.Image,
		ImagePullPolicy: corev1.PullPolicy(p.cfg.ImagePullPolicy),
		Env:             env,
		Ports: []corev1.ContainerPort{
			{Name: "agent", ContainerPort: int32(p.cfg.AgentPort)},
			{Name: "tunnel", ContainerPort: int32(p.cfg.TunnelPort)},
		},
		Resources:       p.resources,
		SecurityContext: &corev1.SecurityContext{Privileged: new(true)},
		VolumeMounts: []corev1.VolumeMount{
			{Name: "kvm", MountPath: "/dev/kvm"},
			{Name: "shm", MountPath: "/dev/shm"},
		},
		ReadinessProbe: &corev1.Probe{
			HTTPGet:       &corev1.HTTPGetAction{Path: "/v1/health", Port: intstr.FromString("agent")},
			PeriodSeconds: 2,
		},
	}}
	if p.cfg.VPN.Enabled() {
		containers = append(containers, corev1.Container{
			Name:  containerVPN,
			Image: p.cfg.VPN.Image,
			Args:  []string{"run", "-c", "/etc/sing-box/" + vpnConfigKey},
			SecurityContext: &corev1.SecurityContext{
				Capabilities: &corev1.Capabilities{Add: []corev1.Capability{"NET_ADMIN"}},
			},
			VolumeMounts: []corev1.VolumeMount{
				{Name: "tun", MountPath: "/dev/net/tun"},
				{Name: "vpn-config", MountPath: "/etc/sing-box", ReadOnly: true},
			},
		})
	}

	var pullSecrets []corev1.LocalObjectReference
	for _, s := range p.cfg.ImagePullSecrets {
		pullSecrets = append(pullSecrets, corev1.LocalObjectReference{Name: s})
	}

	return &corev1.Pod{
		Name:      name,
		Namespace: p.cfg.Namespace,
		Labels:    sessionLabels(id, slot),
		Annotations: map[string]string{
			annotationOwner:        req.Owner,
			annotationPackage:      req.Package,
			annotationArtifactRef:  req.ArtifactRef,
			annotationLocation:     location,
			annotationCreatedAt:    at,
			annotationLastActivity: at,
		},
		Spec: corev1.PodSpec{
			RestartPolicy:                 corev1.RestartPolicyNever,
			AutomountServiceAccountToken:  new(false),
			EnableServiceLinks:            new(false),
			TerminationGracePeriodSeconds: new(int64(5)),
			ImagePullSecrets:              pullSecrets,
			Tolerations:                   p.tolerations(),
			Affinity: &corev1.Affinity{
				NodeAffinity: &corev1.NodeAffinity{
					RequiredDuringSchedulingIgnoredDuringExecution: &corev1.NodeSelector{
						NodeSelectorTerms: []corev1.NodeSelectorTerm{{
							MatchExpressions: []corev1.NodeSelectorRequirement{{Key: hostnameLabel, Operator: corev1.NodeSelectorOpIn, Values: []string{slot}}},
						}},
					},
				},
				PodAntiAffinity: &corev1.PodAntiAffinity{
					RequiredDuringSchedulingIgnoredDuringExecution: []corev1.PodAffinityTerm{{
						LabelSelector: &metav1.LabelSelector{MatchLabels: podSelector},
						TopologyKey:   hostnameLabel,
					}},
				},
			},
			Containers: containers,
			Volumes:    volumes,
		},
	}
}

func renderSecret(pod *corev1.Pod, config []byte) *corev1.Secret {
	return &corev1.Secret{
		Name:      pod.Name,
		Namespace: pod.Namespace,
		Labels:    pod.Labels,
		OwnerReferences: []metav1.OwnerReference{{
			APIVersion: "v1",
			Kind:       "Pod",
			Name:       pod.Name,
			UID:        pod.UID,
		}},
		Type:       corev1.SecretTypeOpaque,
		StringData: map[string]string{vpnConfigKey: string(config)},
	}
}

func (p *Provider) podSession(pod corev1.Pod) contract.Session {
	a := pod.Annotations
	created := parseTime(a[annotationCreatedAt], pod.CreationTimestamp.Time)
	state, reason := podState(pod)
	detail := ""
	if state == contract.StateProvisioning {
		detail = pending(pod)
	}
	agentURL, tunnelURL := "", ""
	if pod.Status.PodIP != "" {
		agentURL = "http://" + net.JoinHostPort(pod.Status.PodIP, strconv.Itoa(p.cfg.AgentPort))
		tunnelURL = "http://" + net.JoinHostPort(pod.Status.PodIP, strconv.Itoa(p.cfg.TunnelPort))
	}
	return contract.Session{
		ID:           pod.Labels[labelSession],
		Slot:         pod.Labels[labelSlot],
		Owner:        a[annotationOwner],
		Package:      a[annotationPackage],
		ArtifactRef:  a[annotationArtifactRef],
		Location:     a[annotationLocation],
		State:        state,
		Reason:       reason,
		Detail:       detail,
		AgentURL:     agentURL,
		TunnelURL:    tunnelURL,
		CreatedAt:    created,
		LastActivity: parseTime(a[annotationLastActivity], created),
	}
}

func parseTime(s string, fallback time.Time) time.Time {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return fallback.UTC()
	}
	return t.UTC()
}

// gracePeriod force-deletes a Pod none of whose containers has started:
// kubelet doesn't cancel an image pull, so a graceful delete would hold the
// slot until the pull finishes.
func gracePeriod(pod corev1.Pod) *int64 {
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Running != nil || cs.State.Terminated != nil {
			return nil
		}
	}
	return new(int64(0))
}

// podState maps the Pod to a coarse session state; its readiness probe
// passes only once the app runs.
func podState(pod corev1.Pod) (contract.SessionState, string) {
	if pod.DeletionTimestamp != nil {
		return contract.StateStopping, ""
	}
	if pod.Status.Phase == corev1.PodFailed || pod.Status.Phase == corev1.PodSucceeded {
		return contract.StateFailed, cmp.Or(pod.Status.Message, pod.Status.Reason, terminated(pod), "pod "+string(pod.Status.Phase))
	}
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.Name != containerEmulator {
			continue
		}
		switch {
		case cs.State.Terminated != nil:
			return contract.StateFailed, terminated(pod)
		case cs.Ready:
			return contract.StateReady, ""
		case cs.State.Running != nil:
			return contract.StateBooting, ""
		}
	}
	return contract.StateProvisioning, ""
}

// pending explains what a Pod that hasn't started its emulator waits for.
func pending(pod corev1.Pod) string {
	for _, c := range pod.Status.Conditions {
		if c.Type == corev1.PodScheduled && c.Status == corev1.ConditionFalse {
			return cmp.Or("Waiting for the node: "+c.Message, "Waiting for the node")
		}
	}
	for _, cs := range pod.Status.ContainerStatuses {
		w := cs.State.Waiting
		if cs.Name != containerEmulator || w == nil {
			continue
		}
		switch w.Reason {
		case "ContainerCreating", "PodInitializing", "":
			return "Starting the device container"
		case "ErrImagePull", "ImagePullBackOff":
			return "The session image " + cs.Image + " can't be pulled yet, retrying (a new build may still be publishing it)"
		}
		return w.Reason + ": " + w.Message
	}
	return ""
}

func terminated(pod corev1.Pod) string {
	for _, cs := range pod.Status.ContainerStatuses {
		if t := cs.State.Terminated; t != nil {
			return fmt.Sprintf("%s exited with code %d: %s", cs.Name, t.ExitCode, cmp.Or(t.Message, t.Reason))
		}
	}
	return ""
}
