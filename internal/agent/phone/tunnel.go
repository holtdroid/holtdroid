package phone

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// TunnelPackage is Holtdroid Tunnel (github.com/kriakiku/holtdroid-tunnel),
// the VpnService that sends the phone's traffic over adb reverse to the host.
const TunnelPackage = "io.github.kriakiku.holtdroid.tunnel"

const tunnelReceiver = TunnelPackage + "/.ControlReceiver"

// Tunnel is how a session's phone reaches the internet: through the tunnel
// app to Port on the phone, which adb reverse maps to HostPort, a sing-box
// mixed inbound on the host.
type Tunnel struct {
	APK      string
	Version  string
	Port     int
	HostPort int
	IPv6     bool
}

// TunnelADB is what the tunnel needs from adb besides a shell.
type TunnelADB interface {
	Shell(ctx context.Context, cmd string) (string, error)
	Install(ctx context.Context, apk string) error
	Reverse(ctx context.Context, port, local int) error
}

type tunnelStatus struct {
	State   string `json:"state"`
	Version string `json:"version"`
	Consent bool   `json:"consent"`
	Error   string `json:"error"`
	Proxy   string `json:"proxy"`
}

// start installs the app when it is missing or another version, turns the
// radios off so nothing leaves the phone except through the host, maps the
// port and starts the VPN.
func (t *Tunnel) start(ctx context.Context, adb TunnelADB) error {
	st, _, err := broadcast(ctx, adb, "STATUS", "")
	if err != nil || t.Version != "" && st.Version != t.Version {
		if t.APK == "" {
			return errors.New("the tunnel app is not installed and no apk is configured")
		}
		if err := adb.Install(ctx, t.APK); err != nil {
			return fmt.Errorf("install the tunnel app: %w", err)
		}
	}
	if _, err := adb.Shell(ctx, "appops set "+TunnelPackage+" ACTIVATE_VPN allow; svc wifi disable; svc data disable"); err != nil {
		return err
	}
	if err := adb.Reverse(ctx, t.Port, t.HostPort); err != nil {
		return fmt.Errorf("map the tunnel port: %w", err)
	}
	st, code, err := broadcast(ctx, adb, "START", fmt.Sprintf("--ei port %d --ez ipv6 %t", t.Port, t.IPv6))
	switch {
	case err != nil:
		return err
	case code == 2:
		return errors.New("the tunnel app has no VPN consent: accept it on the phone once")
	case code != -1 || st.State != "running":
		return fmt.Errorf("the tunnel did not start: %s", st.Error)
	}
	return nil
}

// running tells whether the VPN is up and reaches the host.
func (t *Tunnel) running(ctx context.Context, adb TunnelADB) (bool, error) {
	st, _, err := broadcast(ctx, adb, "STATUS", "")
	if err != nil {
		return false, err
	}
	return st.State == "running" && st.Proxy == "ok", nil
}

const stopTunnel = "am broadcast -n " + tunnelReceiver + " -a " + TunnelPackage + ".STOP >/dev/null 2>&1"

var broadcastResult = regexp.MustCompile(`Broadcast completed: result=(-?\d+)(?:, data="(.*)")?\s*$`)

func broadcast(ctx context.Context, adb TunnelADB, action, extras string) (tunnelStatus, int, error) {
	cmd := "am broadcast -n " + tunnelReceiver + " -a " + TunnelPackage + "." + action
	if extras != "" {
		cmd += " " + extras
	}
	out, err := adb.Shell(ctx, cmd)
	if err != nil {
		return tunnelStatus{}, 0, err
	}
	return parseBroadcast(out)
}

// parseBroadcast reads am's last line; am doesn't escape the data, so it is
// everything between the first data=" and the final quote.
func parseBroadcast(out string) (tunnelStatus, int, error) {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	m := broadcastResult.FindStringSubmatch(strings.TrimSpace(lines[len(lines)-1]))
	if m == nil {
		return tunnelStatus{}, 0, fmt.Errorf("tunnel app: unexpected reply %q", strings.TrimSpace(out))
	}
	code, _ := strconv.Atoi(m[1])
	var st tunnelStatus
	if m[2] == "" {
		return st, code, fmt.Errorf("tunnel app is not installed or did not answer (result %d)", code)
	}
	if err := json.Unmarshal([]byte(m[2]), &st); err != nil {
		return st, code, fmt.Errorf("tunnel app: %w", err)
	}
	return st, code, nil
}
