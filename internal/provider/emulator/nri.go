package emulator

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"strconv"
	"strings"

	"github.com/containerd/nri/pkg/api"
	"github.com/containerd/nri/pkg/stub"
	"golang.org/x/sys/unix"
)

// annotationDevices asks the session-devices NRI plugin for the Android
// container's devices; only unprivileged session Pods carry it.
const annotationDevices = "holtdroid/devices"

// DevicesConfig configures the session-devices NRI plugin.
type DevicesConfig struct {
	// Namespace is where session Pods run; Pods elsewhere get nothing.
	Namespace string
	// GPU is the node's DRI render node, the same as redroid.gpu.
	GPU string
	// Loops is how many /dev/loopN nodes Android sees: APEX activation takes
	// about 36 per session, numbered across the node.
	Loops int
	// Socket is the runtime's NRI socket.
	Socket string
}

func DefaultDevicesConfig() DevicesConfig {
	return DevicesConfig{Namespace: "holtdroid", GPU: "/dev/dri/renderD128", Loops: 512, Socket: "/var/run/nri/nri.sock"}
}

// devicePlugin adds the device nodes and device cgroup rules redroid needs to
// unprivileged Android containers: binder (any minor, since each container
// mounts its own binderfs), the loop devices APEX activation takes, FUSE, TUN,
// the GPU render node, and /dev/kmsg pointed at /dev/null so Android's
// kernel logging stays out of the node's log.
type devicePlugin struct {
	namespace string
	devices   []*api.LinuxDevice
	rules     []*api.LinuxDeviceCgroup
}

func newDevicePlugin(cfg DevicesConfig, procDevices io.Reader, gpu func(string) (int64, int64, error)) (*devicePlugin, error) {
	binder, err := charMajor(procDevices, "binder")
	if err != nil {
		return nil, err
	}
	p := &devicePlugin{namespace: cfg.Namespace}
	add := func(path, typ string, major, minor int64) {
		p.devices = append(p.devices, &api.LinuxDevice{
			Path: path, Type: typ, Major: major, Minor: minor,
			FileMode: &api.OptionalFileMode{Value: 0o666}, Uid: &api.OptionalUInt32{}, Gid: &api.OptionalUInt32{},
		})
		p.rules = append(p.rules, deviceRule(typ, major, minor))
	}
	add("/dev/kmsg", "c", 1, 3)
	add("/dev/fuse", "c", 10, 229)
	add("/dev/net/tun", "c", 10, 200)
	add("/dev/loop-control", "c", 10, 237)
	if cfg.GPU != "" {
		major, minor, err := gpu(cfg.GPU)
		if err != nil {
			return nil, fmt.Errorf("gpu %s: %w", cfg.GPU, err)
		}
		add(cfg.GPU, "c", major, minor)
	}
	for i := range cfg.Loops {
		p.devices = append(p.devices, &api.LinuxDevice{
			Path: "/dev/loop" + strconv.Itoa(i), Type: "b", Major: 7, Minor: int64(i),
			FileMode: &api.OptionalFileMode{Value: 0o660}, Uid: &api.OptionalUInt32{}, Gid: &api.OptionalUInt32{},
		})
	}
	p.rules = append(p.rules, deviceRule("b", 7, -1), deviceRule("c", binder, -1))
	return p, nil
}

func deviceRule(typ string, major, minor int64) *api.LinuxDeviceCgroup {
	r := &api.LinuxDeviceCgroup{Allow: true, Type: typ, Major: &api.OptionalInt64{Value: major}, Access: "rwm"}
	if minor >= 0 {
		r.Minor = &api.OptionalInt64{Value: minor}
	}
	return r
}

func charMajor(procDevices io.Reader, name string) (int64, error) {
	s := bufio.NewScanner(procDevices)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line == "Block devices:" {
			break
		}
		if f := strings.Fields(line); len(f) == 2 && f[1] == name {
			return strconv.ParseInt(f[0], 10, 64)
		}
	}
	if err := s.Err(); err != nil {
		return 0, err
	}
	return 0, fmt.Errorf("no %s character device in /proc/devices: the kernel needs CONFIG_ANDROID_BINDERFS", name)
}

func (p *devicePlugin) CreateContainer(_ context.Context, pod *api.PodSandbox, ctr *api.Container) (*api.ContainerAdjustment, []*api.ContainerUpdate, error) {
	if pod.Namespace != p.namespace || ctr.Name != containerAndroid || pod.Annotations[annotationDevices] == "" ||
		pod.Labels["app.kubernetes.io/managed-by"] != podSelector["app.kubernetes.io/managed-by"] {
		return nil, nil, nil
	}
	adj := &api.ContainerAdjustment{}
	for _, d := range p.devices {
		adj.AddDevice(d)
	}
	adj.Linux.Resources = &api.LinuxResources{Devices: p.rules}
	slog.Info("devices added", "pod", pod.Name)
	return adj, nil, nil
}

// RunDevicePlugin serves the session-devices NRI plugin until the runtime
// closes the connection.
func RunDevicePlugin(ctx context.Context, cfg DevicesConfig) error {
	f, err := os.Open("/proc/devices")
	if err != nil {
		return err
	}
	p, err := newDevicePlugin(cfg, f, statDevice)
	_ = f.Close()
	if err != nil {
		return err
	}
	s, err := stub.New(p, stub.WithPluginName("holtdroid-session-devices"), stub.WithPluginIdx("10"), stub.WithSocketPath(cfg.Socket))
	if err != nil {
		return err
	}
	err = s.Run(ctx)
	switch {
	case ctx.Err() != nil:
		return nil //nolint:nilerr // stopping is not a failure
	case err != nil:
		return err
	default:
		return errors.New("the runtime closed the NRI connection")
	}
}

func statDevice(path string) (int64, int64, error) {
	var st unix.Stat_t
	if err := unix.Stat(path, &st); err != nil {
		return 0, 0, err
	}
	if st.Mode&unix.S_IFMT != unix.S_IFCHR {
		return 0, 0, &fs.PathError{Op: "stat", Path: path, Err: errors.New("not a character device")}
	}
	return int64(unix.Major(uint64(st.Rdev))), int64(unix.Minor(uint64(st.Rdev))), nil
}
