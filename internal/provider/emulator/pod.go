package emulator

import (
	"cmp"
	"fmt"
	"maps"
	"net"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/holtdroid/holtdroid/internal/agent"
	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/vpn"
)

const (
	labelSession = "holtdroid/session"
	labelSlot    = "holtdroid/slot"
	labelNode    = "holtdroid/node"

	annotationOwner        = "holtdroid/owner"
	annotationPackage      = "holtdroid/package"
	annotationArtifactRef  = "holtdroid/artifact-ref"
	annotationLocation     = "holtdroid/location"
	annotationScreen       = "holtdroid/screen"
	annotationAndroid      = "holtdroid/android"
	annotationAppData      = "holtdroid/app-data"
	annotationWebView      = "holtdroid/webview"
	annotationCreatedAt    = "holtdroid/created-at"
	annotationLastActivity = "holtdroid/last-activity"

	containerAndroid = "android"
	containerAgent   = "agent"
	containerVPN     = "vpn"
	vpnConfigKey     = "config.json"
	hostnameLabel    = "kubernetes.io/hostname"
	hostCgroup       = "/host/cgroup"
)

// device is what a launch picked for its Android container.
type device struct {
	screen   contract.Display
	version  string
	image    string
	location string
}

var podSelector = map[string]string{
	"app.kubernetes.io/name":       "holtdroid-session",
	"app.kubernetes.io/managed-by": "holtdroid-provider-emulator",
}

func podName(id string) string { return "holtdroid-session-" + id }

func sessionLabels(id, slot, node string) map[string]string {
	l := map[string]string{labelSession: id, labelSlot: slot, labelNode: node}
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

func (p *Provider) renderPod(id, slot, node string, req contract.CreateSession, dev device, now time.Time) *corev1.Pod {
	name := podName(id)
	at := now.UTC().Format(time.RFC3339Nano)
	location := dev.location

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
		{Name: "HOLTDROID_ADBSHELL", Value: string(p.cfg.Redroid.Shell)},
		{Name: "ANDROID_ADB_SERVER_PORT", Value: "5038"},
		{Name: "HOLTDROID_HOSTCGROUP", Value: hostCgroup},
		{Name: "HOLTDROID_PODUID", ValueFrom: &corev1.EnvVarSource{FieldRef: &corev1.ObjectFieldSelector{FieldPath: "metadata.uid"}}},
	}
	if c := dev.screen.Cutout; c != "" && c != "none" {
		env = append(env, corev1.EnvVar{Name: "HOLTDROID_REDROID__CUTOUT", Value: c})
	}
	if location != "" {
		env = append(env, corev1.EnvVar{Name: "HOLTDROID_LOCATION", Value: location})
	}
	if req.AppData != nil {
		env = append(env,
			corev1.EnvVar{Name: "HOLTDROID_APPDATA__URL", Value: req.AppData.URL},
			corev1.EnvVar{Name: "HOLTDROID_APPDATA__CACHE", Value: strconv.FormatBool(req.AppData.Cache)},
		)
	}
	if w := req.WebView; w != nil {
		env = append(env,
			corev1.EnvVar{Name: "HOLTDROID_WEBVIEW__URL", Value: w.URL},
			corev1.EnvVar{Name: "HOLTDROID_WEBVIEW__VERSION", Value: w.Version},
		)
		if w.Frontend != "" {
			env = append(env, corev1.EnvVar{Name: "HOLTDROID_WEBVIEW__FRONTEND", Value: w.Frontend})
		}
	}
	if req.Frontend != "" {
		env = append(env, corev1.EnvVar{Name: "HOLTDROID_FRONTEND", Value: req.Frontend})
	}
	if r := req.Recording; r != nil {
		env = append(env,
			corev1.EnvVar{Name: "HOLTDROID_RECORDING__ID", Value: r.ID},
			corev1.EnvVar{Name: "HOLTDROID_RECORDING__URL", Value: r.URL},
		)
	}
	resources, ok := p.nodeRes[node]
	if !ok {
		resources = p.resources
	}
	ports := []corev1.ContainerPort{
		{Name: "agent", ContainerPort: int32(p.cfg.AgentPort)},
		{Name: "tunnel", ContainerPort: int32(p.cfg.TunnelPort)},
	}
	if mp := p.cfg.SessionTelemetry.MetricsPort; mp != 0 {
		env = append(env, corev1.EnvVar{Name: "HOLTDROID_TELEMETRY__METRICS__LISTEN", Value: ":" + strconv.Itoa(mp)})
		ports = append(ports, corev1.ContainerPort{Name: "metrics", ContainerPort: int32(mp)})
	}
	if tr := p.cfg.SessionTelemetry.Tracing; tr.Enabled {
		env = append(env,
			corev1.EnvVar{Name: "HOLTDROID_TELEMETRY__TRACING__ENABLED", Value: "true"},
			corev1.EnvVar{Name: "HOLTDROID_TELEMETRY__TRACING__ENDPOINT", Value: tr.Endpoint},
			corev1.EnvVar{Name: "HOLTDROID_TELEMETRY__TRACING__INSECURE", Value: strconv.FormatBool(tr.Insecure)},
			corev1.EnvVar{Name: "HOLTDROID_TELEMETRY__TRACING__SAMPLERATIO", Value: strconv.FormatFloat(tr.SampleRatio, 'g', -1, 64)},
		)
	}
	data := &corev1.EmptyDirVolumeSource{}
	if q, err := resource.ParseQuantity(p.cfg.Redroid.DataSize); p.cfg.Redroid.DataSize != "" && err == nil {
		data.SizeLimit = &q
	}
	volumes := []corev1.Volume{
		{Name: "data", EmptyDir: data},
		{Name: "cgroup", HostPath: &corev1.HostPathVolumeSource{Path: "/sys/fs/cgroup", Type: new(corev1.HostPathDirectory)}},
	}
	if p.cfg.VPN.Enabled() {
		env = append(env,
			corev1.EnvVar{Name: "HOLTDROID_CLASHAPI", Value: "http://" + vpn.ClashAPI},
			corev1.EnvVar{Name: "HOLTDROID_IPINFOPROXY", Value: "http://" + vpn.Proxy},
			corev1.EnvVar{Name: "HOLTDROID_REDROID__VPN", Value: "true"},
			corev1.EnvVar{Name: "HOLTDROID_REDROID__BYPASS", Value: strings.Join(p.cfg.VPN.BypassCIDRs, ",")},
		)
		env = append(env, geoEnv(p.cfg.VPN)...)
		volumes = append(volumes,
			corev1.Volume{Name: "tun", HostPath: &corev1.HostPathVolumeSource{Path: "/dev/net/tun", Type: new(corev1.HostPathCharDev)}},
			corev1.Volume{Name: "vpn-config", Secret: &corev1.SecretVolumeSource{SecretName: name}},
		)
	}

	containers := []corev1.Container{
		{
			Name:            containerAndroid,
			Image:           dev.image,
			ImagePullPolicy: corev1.PullPolicy(p.cfg.ImagePullPolicy),
			Args:            p.bootArgs(dev.screen),
			Resources:       resources,
			SecurityContext: &corev1.SecurityContext{Privileged: new(true), RunAsUser: new(int64(0)), RunAsGroup: new(int64(0))},
			VolumeMounts:    []corev1.VolumeMount{{Name: "data", MountPath: "/data"}},
		},
		{
			Name:            containerAgent,
			Image:           p.cfg.Image,
			ImagePullPolicy: corev1.PullPolicy(p.cfg.ImagePullPolicy),
			Env:             env,
			Ports:           ports,
			Resources:       p.agentRes,
			SecurityContext: &corev1.SecurityContext{
				AllowPrivilegeEscalation: new(false),
				Capabilities:             &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
			},
			VolumeMounts: []corev1.VolumeMount{{Name: "cgroup", MountPath: hostCgroup, ReadOnly: true}},
			ReadinessProbe: &corev1.Probe{
				HTTPGet:       &corev1.HTTPGetAction{Path: "/v1/health", Port: intstr.FromString("agent")},
				PeriodSeconds: 2,
			},
		},
	}
	if p.cfg.VPN.Enabled() {
		containers[1].SecurityContext.Capabilities.Add = []corev1.Capability{"NET_ADMIN"}
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

	annotations := map[string]string{
		annotationOwner:        req.Owner,
		annotationPackage:      req.Package,
		annotationArtifactRef:  req.ArtifactRef,
		annotationLocation:     location,
		annotationScreen:       dev.screen.ID,
		annotationAndroid:      dev.version,
		annotationCreatedAt:    at,
		annotationLastActivity: at,
	}
	if req.AppData != nil {
		annotations[annotationAppData] = string(req.AppData.Kind())
	}
	if req.WebView != nil {
		annotations[annotationWebView] = req.WebView.Version
	}

	return &corev1.Pod{
		Name:        name,
		Namespace:   p.cfg.Namespace,
		Labels:      sessionLabels(id, slot, node),
		Annotations: annotations,
		Spec: corev1.PodSpec{
			RestartPolicy:                 corev1.RestartPolicyNever,
			AutomountServiceAccountToken:  new(false),
			EnableServiceLinks:            new(false),
			TerminationGracePeriodSeconds: new(int64(5)),
			ImagePullSecrets:              pullSecrets,
			Tolerations:                   p.tolerations(),
			SecurityContext:               &corev1.PodSecurityContext{SupplementalGroupsPolicy: new(corev1.SupplementalGroupsPolicyStrict)},
			Affinity: &corev1.Affinity{
				NodeAffinity: &corev1.NodeAffinity{
					RequiredDuringSchedulingIgnoredDuringExecution: &corev1.NodeSelector{
						NodeSelectorTerms: []corev1.NodeSelectorTerm{{
							MatchExpressions: []corev1.NodeSelectorRequirement{{Key: hostnameLabel, Operator: corev1.NodeSelectorOpIn, Values: []string{node}}},
						}},
					},
				},
			},
			Containers: containers,
			Volumes:    volumes,
		},
	}
}

// bootArgs are redroid's kernel-style boot arguments: the GPU, the screen
// and memfd instead of ashmem, which mainline kernels no longer have.
func (p *Provider) bootArgs(screen contract.Display) []string {
	r := p.cfg.Redroid
	args := []string{
		"qemu=1",
		"androidboot.hardware=redroid",
		"androidboot.use_memfd=true",
		"androidboot.redroid_gpu_mode=host",
		"androidboot.redroid_gpu_node=" + r.GPU,
		"androidboot.redroid_width=" + strconv.Itoa(screen.Width),
		"androidboot.redroid_height=" + strconv.Itoa(screen.Height),
		"androidboot.redroid_dpi=" + strconv.Itoa(screen.DPI),
		"androidboot.redroid_fps=" + strconv.Itoa(r.FPS),
	}
	return append(args, r.Args...)
}

// geoEnv hands the agent where each location is, so the GPS and the time
// zone follow a location switch.
func geoEnv(v vpn.Config) []corev1.EnvVar {
	var env []corev1.EnvVar
	for _, l := range v.Locations {
		key := "HOLTDROID_GEO__" + strings.ToUpper(l.ID) + "__"
		if l.Timezone != "" {
			env = append(env, corev1.EnvVar{Name: key + "TIMEZONE", Value: l.Timezone})
		}
		if g := l.Geo; g != nil {
			f := func(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
			env = append(env,
				corev1.EnvVar{Name: key + "LAT", Value: f(g.Lat)},
				corev1.EnvVar{Name: key + "LNG", Value: f(g.Lng)},
				corev1.EnvVar{Name: key + "RADIUS", Value: f(g.Radius)},
			)
		}
	}
	return env
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
	caps := &contract.SlotCapabilities{
		Android:  a[annotationAndroid],
		ABIs:     []string{"x86_64", "arm64-v8a"},
		Root:     true,
		DevTools: contract.DevToolsAll,
		ADB:      true,
		Shell:    p.cfg.Redroid.Shell == agent.ShellFull,
		AppData:  true,
	}
	if screen, err := p.cfg.Redroid.screen(a[annotationScreen]); err == nil {
		caps.Model = model(screen)
		caps.Screen = &screen
	}
	return contract.Session{
		ID:           pod.Labels[labelSession],
		Slot:         pod.Labels[labelSlot],
		Owner:        a[annotationOwner],
		Package:      a[annotationPackage],
		ArtifactRef:  a[annotationArtifactRef],
		Location:     a[annotationLocation],
		AppData:      contract.AppDataKind(a[annotationAppData]),
		WebView:      a[annotationWebView],
		State:        state,
		Reason:       reason,
		Detail:       detail,
		Capabilities: caps,
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
		if cs.Name != containerVPN && cs.State.Terminated != nil {
			return contract.StateFailed, terminated(pod)
		}
	}
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.Name != containerAgent {
			continue
		}
		switch {
		case cs.Ready:
			return contract.StateReady, ""
		case cs.State.Running != nil:
			return contract.StateBooting, ""
		}
	}
	return contract.StateProvisioning, ""
}

// pending explains what a Pod that hasn't started its device waits for.
func pending(pod corev1.Pod) string {
	for _, c := range pod.Status.Conditions {
		if c.Type == corev1.PodScheduled && c.Status == corev1.ConditionFalse {
			return cmp.Or("Waiting for the node: "+c.Message, "Waiting for the node")
		}
	}
	for _, cs := range pod.Status.ContainerStatuses {
		w := cs.State.Waiting
		if cs.Name == containerVPN || w == nil {
			continue
		}
		switch w.Reason {
		case "ContainerCreating", "PodInitializing", "":
			continue
		case "ErrImagePull", "ImagePullBackOff":
			return "The image " + cs.Image + " can't be pulled yet, retrying (a new build may still be publishing it)"
		}
		return w.Reason + ": " + w.Message
	}
	if len(pod.Status.ContainerStatuses) > 0 {
		return "Starting the device containers"
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
