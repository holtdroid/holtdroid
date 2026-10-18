package connect

import (
	"context"
	"net"
	"os"
	"slices"

	gnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"

	"github.com/kriakiku/holtdroid/internal/contract/control"
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
