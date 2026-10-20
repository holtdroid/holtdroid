package connect

import (
	"context"
	"net"
	"os"
	"slices"
	"strings"

	gnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"

	"github.com/holtdroid/holtdroid/internal/contract/control"
)

// listening lists TCP ports a device could reach through the loopback:
// listeners on a loopback or wildcard address, except this process's own.
func listening(ctx context.Context, names map[int32]string) ([]control.LocalPort, error) {
	conns, err := gnet.ConnectionsWithContext(ctx, "tcp")
	if err != nil {
		return nil, err
	}
	self := int32(os.Getpid())
	seen := map[int]bool{}
	var out []control.LocalPort
	for _, c := range conns {
		if c.Status != "LISTEN" || c.Pid == self || c.Laddr.Port == 0 || seen[int(c.Laddr.Port)] {
			continue
		}
		ip := net.ParseIP(c.Laddr.IP)
		if c.Laddr.IP != "*" && (ip == nil || !ip.IsLoopback() && !ip.IsUnspecified()) {
			continue
		}
		seen[int(c.Laddr.Port)] = true
		out = append(out, control.LocalPort{Port: int(c.Laddr.Port), Process: processName(ctx, c.Pid, names)})
	}
	slices.SortFunc(out, func(a, b control.LocalPort) int { return a.Port - b.Port })
	return out, nil
}

func processName(ctx context.Context, pid int32, names map[int32]string) string {
	if pid <= 0 {
		return ""
	}
	if name, ok := names[pid]; ok {
		return name
	}
	name := ""
	if p, err := process.NewProcessWithContext(ctx, pid); err == nil {
		name, _ = p.NameWithContext(ctx)
	}
	names[pid] = name
	return name
}

// wanted is what to publish: the pinned ports plus what the mode adds.
// Callers hold cl.mu.
func (cl *Client) wanted() []int {
	ports := append(slices.Clone(cl.st.Published), autoPublished(cl.st.Mode, cl.listening)...)
	slices.Sort(ports)
	return slices.Compact(ports)
}

// adbServerPort is the host's adb server.
const adbServerPort = 5037

// neverAuto are listeners the automatic modes skip: the adb server and
// emulators would give the devices control over other devices, and another
// holtdroid client's ports are its devices' ADB. This client's own ADB
// ports never show up in listening at all.
var neverAuto = []string{"adb", "qemu-system", "emulator", "holtdroid"}

func autoPublished(mode control.PublishMode, list []control.LocalPort) []int {
	if mode != control.PublishDev && mode != control.PublishAll {
		return nil
	}
	var out []int
	for _, p := range list {
		name := strings.ToLower(p.Process)
		if p.Port == adbServerPort || slices.ContainsFunc(neverAuto, func(n string) bool { return strings.HasPrefix(name, n) }) {
			continue
		}
		if mode == control.PublishAll || IsDevServer(p.Process) {
			out = append(out, p.Port)
		}
	}
	return out
}

var devProcesses = []string{
	"node", "bun", "deno", "python", "ruby", "php", "java", "dotnet", "go", "nginx", "caddy", "httpd", "beam.smp",
	"uvicorn", "gunicorn", "puma", "next-server", "vite", "esbuild", "mitmproxy", "mitmweb", "charles",
}

// IsDevServer guesses from the process name whether a port is something a
// developer would publish, rather than a system service or desktop app.
// The portal's Computers page uses the same list.
func IsDevServer(process string) bool {
	name := strings.ToLower(process)
	if name == "" {
		return false
	}
	for _, p := range devProcesses {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}
