package phone

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	singBoxRemote = "/data/local/tmp/holtdroid-sing-box"
	singBoxConfig = "/data/local/tmp/holtdroid-sing-box.json"
	singBoxLog    = "/data/local/tmp/holtdroid-sing-box.log"
	rootTunnelIf  = "holtdroidtun"
	magiskSELinux = "u:r:magisk:s0"
	defaultProbe  = "http://connectivitycheck.gstatic.com/generate_204"
)

// RootTunnel carries a rooted phone's traffic transparently: a sing-box tun,
// started through su in the magisk SELinux domain so netlink works, takes the
// device's default route and sends everything to a socks outbound on Port,
// which adb reverse maps to HostPort — the host's per-session sing-box. The
// app sees an ordinary Wi-Fi transport, not a VpnService. The phone needs no
// network of its own: egress is the loopback socks over the USB cable, and a
// dummy default route gives sing-box an interface to start against.
//
// The default route is only swung into the tun while the host egress is
// healthy; if it is down the default stays on the dummy, so traffic fails
// fast instead of hanging in a tun with no way out and starving the system.
type RootTunnel struct {
	SingBox  string // arm64 sing-box on the provider, pushed to the phone
	Port     int    // phone-side loopback port the socks outbound dials
	HostPort int    // host sing-box mixed inbound, reached over adb reverse
	Probe    string // URL fetched through the host proxy to test egress
}

// dummyDefault gives the phone a default route to a dead dummy interface, so
// it has somewhere to send packets (fast-failing) while the egress is down,
// instead of hanging in a tun with no way out. A plain dev route needs no
// reachable gateway.
const dummyDefault = "ip link set dummy0 up; ip route replace default dev dummy0 2>/dev/null; true"

const routeDummy = "ip route replace default dev dummy0"

// magiskShell runs cmd as root in the magisk SELinux domain, where tun,
// routes and iptables are permitted (plain su -c runs as u:r:shell:s0, which
// the kernel's SELinux policy denies those to).
func magiskShell(ctx context.Context, adb ADB, cmd string) (string, error) {
	return adb.Shell(ctx, "su -Z "+magiskSELinux+" -c "+shellQuote(cmd))
}

func (t *RootTunnel) config() string {
	// auto_route is off: on a phone with no real network sing-box's own route
	// setup fails ("network is unreachable"), so the agent adds the default
	// route into the tun itself. Loopback stays direct so the socks upstream
	// (adb reverse) is not looped back in.
	return fmt.Sprintf(`{
  "log": {"level": "warn"},
  "inbounds": [
    {"type": "tun", "tag": "tun-in", "interface_name": %q, "address": ["172.19.0.1/30"], "mtu": 1500, "auto_route": false, "stack": "system"}
  ],
  "outbounds": [
    {"type": "socks", "tag": "proxy", "server": "127.0.0.1", "server_port": %d},
    {"type": "direct", "tag": "direct"}
  ],
  "route": {"rules": [{"ip_cidr": ["127.0.0.0/8", "::1/128"], "outbound": "direct"}], "final": "proxy"}
}`, rootTunnelIf, t.Port)
}

// start pushes sing-box and its config, maps the port, launches the tun router
// detached as root and routes the device into it once the egress is healthy.
func (t *RootTunnel) start(ctx context.Context, adb ADB) error {
	if out, err := adb.Shell(ctx, "[ -x "+singBoxRemote+" ] && echo yes || echo no"); err != nil {
		return err
	} else if strings.TrimSpace(out) != "yes" {
		if t.SingBox == "" {
			return errors.New("no sing-box binary configured for the phone")
		}
		if err := adb.Push(ctx, t.SingBox, singBoxRemote); err != nil {
			return fmt.Errorf("push sing-box: %w", err)
		}
		if _, err := adb.Shell(ctx, "chmod 755 "+singBoxRemote); err != nil {
			return err
		}
	}
	cfg, err := os.CreateTemp("", "holtdroid-sb-*.json")
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
	if _, err := magiskShell(ctx, adb, dummyDefault); err != nil {
		return fmt.Errorf("dummy default route: %w", err)
	}
	if _, err := magiskShell(ctx, adb, stopRootTunnel); err != nil {
		return err
	}
	if _, err := magiskShell(ctx, adb, "nohup "+singBoxRemote+" run -c "+singBoxConfig+" >"+singBoxLog+" 2>&1 &"); err != nil {
		return fmt.Errorf("start sing-box: %w", err)
	}
	for range 10 {
		if ok, err := t.exists(ctx, adb); err != nil {
			return err
		} else if ok {
			// Routing is best effort: a down egress must not fail the
			// session, only keep the default off the tun. It is retried each
			// poll through running.
			_ = t.reroute(ctx, adb)
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	out, _ := adb.Shell(ctx, "tail -n 3 "+singBoxLog+" 2>/dev/null")
	return fmt.Errorf("the tun router did not come up: %s", strings.TrimSpace(out))
}

// stopRootTunnel kills the tun router. The [h] keeps the pattern from matching
// pkill's own command line (which contains the pattern text), so it doesn't
// signal its own shell.
const stopRootTunnel = "pkill -f '[h]oltdroid-sing-box run' >/dev/null 2>&1; true"

// exists reports whether the tun interface is present, i.e. sing-box is up.
func (t *RootTunnel) exists(ctx context.Context, adb ADB) (bool, error) {
	out, err := magiskShell(ctx, adb, "ip link show "+rootTunnelIf+" 2>/dev/null || true")
	if err != nil {
		return false, err
	}
	return strings.Contains(out, rootTunnelIf), nil
}

// running reports whether sing-box is up, and each check reroutes by the
// current egress health so a flapping egress never leaves the device hanging
// in a tun with no way out.
func (t *RootTunnel) running(ctx context.Context, adb ADB) (bool, error) {
	ok, err := t.exists(ctx, adb)
	if err != nil || !ok {
		return false, err
	}
	_ = t.reroute(ctx, adb)
	return true, nil
}

// reroute swings the default route into the tun when the host egress answers,
// and back onto the dead dummy when it does not, so a down egress fails fast
// instead of starving the system.
func (t *RootTunnel) reroute(ctx context.Context, adb ADB) error {
	cmd := routeDummy
	if t.healthy(ctx) {
		cmd = "ip link set " + rootTunnelIf + " up; ip route replace default dev " + rootTunnelIf
	}
	_, err := magiskShell(ctx, adb, cmd)
	return err
}

// healthy fetches Probe through the host's per-session proxy to see whether
// the egress actually reaches the internet.
func (t *RootTunnel) healthy(ctx context.Context) bool {
	if t.HostPort == 0 {
		return false
	}
	px, err := url.Parse("http://127.0.0.1:" + strconv.Itoa(t.HostPort))
	if err != nil {
		return false
	}
	hc := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: http.ProxyURL(px)}}
	defer hc.CloseIdleConnections()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cmp.Or(t.Probe, defaultProbe), nil)
	if err != nil {
		return false
	}
	resp, err := hc.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode < 400
}
