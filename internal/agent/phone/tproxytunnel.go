package phone

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	tproxyPort  = 7893
	tproxyMark  = "0x1"
	tproxyTable = "100"
)

// localNets stay off the tunnel so Wi-Fi association, DHCP and the AP keep
// working; everything else is redirected into it.
var localNets = []string{
	"0.0.0.0/8", "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12",
	"192.168.0.0/16", "169.254.0.0/16", "224.0.0.0/4", "240.0.0.0/4",
}

// TproxyTunnel carries a rooted phone's traffic with no tun interface and no
// VpnService: the phone joins a real Wi-Fi network, so apps see an ordinary
// validated Wi-Fi, and iptables TPROXY redirects every non-local packet to a
// sing-box tproxy inbound, which sends it to a socks outbound that adb reverse
// maps to the host's per-session sing-box. There is nothing for an anti-VPN
// app to detect: no VPN transport, no tun. DNS is hijacked by sing-box and
// resolved over the tunnel, so it does not leak the real location.
type TproxyTunnel struct {
	SingBox  string // arm64 sing-box on the provider, pushed to the phone
	Port     int    // phone-side loopback port the socks outbound dials
	HostPort int    // host sing-box, reached over adb reverse (unused here, kept for symmetry)
}

func (t *TproxyTunnel) config() string {
	return fmt.Sprintf(`{
  "log": {"level": "warn"},
  "dns": {
    "servers": [{"type": "tcp", "tag": "remote", "server": "1.1.1.1", "detour": "proxy"}],
    "strategy": "ipv4_only",
    "final": "remote"
  },
  "inbounds": [{"type": "tproxy", "tag": "in", "listen": "0.0.0.0", "listen_port": %d}],
  "outbounds": [
    {"type": "socks", "tag": "proxy", "server": "127.0.0.1", "server_port": %d, "version": "5"},
    {"type": "direct", "tag": "direct"}
  ],
  "route": {"rules": [{"action": "sniff"}, {"protocol": "dns", "action": "hijack-dns"}], "final": "proxy"}
}`, tproxyPort, t.Port)
}

// tproxyRules redirects non-local traffic into the sing-box tproxy inbound.
// PREROUTING catches forwarded packets; OUTPUT marks locally generated ones so
// an ip rule loops them back through the local table into the TPROXY target.
// Root (sing-box itself) is excluded so its upstream is not redirected.
func tproxyRules() string {
	var b strings.Builder
	b.WriteString("ip rule add fwmark " + tproxyMark + " lookup " + tproxyTable + " 2>/dev/null; ")
	b.WriteString("ip route replace local default dev lo table " + tproxyTable + "; ")
	for _, ch := range []string{"HOLTDROID", "HOLTDROIDMARK"} {
		b.WriteString("iptables -t mangle -F " + ch + " 2>/dev/null; iptables -t mangle -N " + ch + " 2>/dev/null; ")
		for _, n := range localNets {
			b.WriteString("iptables -t mangle -A " + ch + " -d " + n + " -j RETURN; ")
		}
	}
	b.WriteString("iptables -t mangle -A HOLTDROID -p tcp -j TPROXY --on-port " + strconv.Itoa(tproxyPort) + " --tproxy-mark " + tproxyMark + "; ")
	b.WriteString("iptables -t mangle -A HOLTDROID -p udp -j TPROXY --on-port " + strconv.Itoa(tproxyPort) + " --tproxy-mark " + tproxyMark + "; ")
	b.WriteString("iptables -t mangle -A HOLTDROIDMARK -m owner --uid-owner 0 -j RETURN; ")
	b.WriteString("iptables -t mangle -A HOLTDROIDMARK -p tcp -j MARK --set-mark " + tproxyMark + "; ")
	b.WriteString("iptables -t mangle -A HOLTDROIDMARK -p udp -j MARK --set-mark " + tproxyMark + "; ")
	b.WriteString("iptables -t mangle -D PREROUTING -j HOLTDROID 2>/dev/null; iptables -t mangle -A PREROUTING -j HOLTDROID; ")
	b.WriteString("iptables -t mangle -D OUTPUT -j HOLTDROIDMARK 2>/dev/null; iptables -t mangle -A OUTPUT -j HOLTDROIDMARK; ")
	b.WriteString("true")
	return b.String()
}

// tproxyTeardown removes everything tproxyRules installed.
const tproxyTeardown = "iptables -t mangle -D PREROUTING -j HOLTDROID 2>/dev/null; " +
	"iptables -t mangle -D OUTPUT -j HOLTDROIDMARK 2>/dev/null; " +
	"iptables -t mangle -F HOLTDROID 2>/dev/null; iptables -t mangle -X HOLTDROID 2>/dev/null; " +
	"iptables -t mangle -F HOLTDROIDMARK 2>/dev/null; iptables -t mangle -X HOLTDROIDMARK 2>/dev/null; " +
	"ip rule del fwmark " + tproxyMark + " lookup " + tproxyTable + " 2>/dev/null; " +
	"ip route flush table " + tproxyTable + " 2>/dev/null; true"

func (t *TproxyTunnel) start(ctx context.Context, adb ADB) error {
	if err := ensureSingBox(ctx, adb, t.SingBox); err != nil {
		return err
	}
	cfg, err := os.CreateTemp("", "holtdroid-tproxy-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(cfg.Name())
	if _, err := cfg.WriteString(t.config()); err != nil {
		cfg.Close()
		return err
	}
	cfg.Close()
	if err := adb.Push(ctx, cfg.Name(), singBoxConfig); err != nil {
		return fmt.Errorf("push sing-box config: %w", err)
	}
	if err := adb.Reverse(ctx, t.Port, t.HostPort); err != nil {
		return fmt.Errorf("map the tunnel port: %w", err)
	}
	if _, err := magiskShell(ctx, adb, stopRootTunnel); err != nil {
		return err
	}
	if _, err := magiskShell(ctx, adb, "nohup "+singBoxRemote+" run -c "+singBoxConfig+" >"+singBoxLog+" 2>&1 &"); err != nil {
		return fmt.Errorf("start sing-box: %w", err)
	}
	for range 10 {
		if up, err := t.up(ctx, adb); err != nil {
			return err
		} else if up {
			if _, err := magiskShell(ctx, adb, tproxyRules()); err != nil {
				return fmt.Errorf("tproxy rules: %w", err)
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	out, _ := adb.Shell(ctx, "tail -n 3 "+singBoxLog+" 2>/dev/null")
	return fmt.Errorf("the tproxy router did not come up: %s", strings.TrimSpace(out))
}

// up reports whether sing-box is running.
func (t *TproxyTunnel) up(ctx context.Context, adb ADB) (bool, error) {
	out, err := adb.Shell(ctx, "pidof holtdroid-sing-box")
	if err != nil {
		return false, nil
	}
	return strings.TrimSpace(out) != "", nil
}

// running keeps the rules in place and reports whether sing-box is up.
func (t *TproxyTunnel) running(ctx context.Context, adb ADB) (bool, error) {
	up, err := t.up(ctx, adb)
	if err != nil || !up {
		return false, err
	}
	_, _ = magiskShell(ctx, adb, tproxyRules())
	return true, nil
}

// ensureSingBox pushes the arm64 sing-box once.
func ensureSingBox(ctx context.Context, adb ADB, bin string) error {
	if out, err := adb.Shell(ctx, "[ -x "+singBoxRemote+" ] && echo yes || echo no"); err != nil {
		return err
	} else if strings.TrimSpace(out) == "yes" {
		return nil
	}
	if bin == "" {
		return fmt.Errorf("no sing-box binary configured for the phone")
	}
	if err := adb.Push(ctx, bin, singBoxRemote); err != nil {
		return fmt.Errorf("push sing-box: %w", err)
	}
	_, err := adb.Shell(ctx, "chmod 755 "+singBoxRemote)
	return err
}
