package physical

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os/exec"
	"regexp"
	"strings"

	"github.com/kriakiku/holtdroid/internal/agent"
	"github.com/kriakiku/holtdroid/internal/agent/phone"
	"github.com/kriakiku/holtdroid/internal/contract"
)

// Host is the machine the phones are plugged into.
type Host interface {
	Devices(ctx context.Context) (map[string]string, error)
	Props(ctx context.Context, serial string) (contract.SlotCapabilities, error)
	Agent(cfg agent.Config, log *slog.Logger) Agent
	Reset(ctx context.Context, serial, pkg string) error
}

// Agent is one session's device agent, running in this process.
type Agent interface {
	Run(ctx context.Context)
	Status(ctx context.Context) contract.StatusEvent
	Install(ctx context.Context, req contract.Install) error
	Handler() http.Handler
	TunnelHandler() http.Handler
}

// ADBHost reaches the phones through the host's adb server.
type ADBHost struct {
	Bin   string
	Phone phone.Config
}

func (h ADBHost) Devices(ctx context.Context) (map[string]string, error) {
	out, err := exec.CommandContext(ctx, h.Bin, "devices").CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("adb devices: %w: %s", err, bytes.TrimSpace(out))
	}
	return parseDevices(string(out)), nil
}

func parseDevices(out string) map[string]string {
	devices := map[string]string{}
	sc := bufio.NewScanner(strings.NewReader(out))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 2 && f[0] != "List" {
			devices[f[0]] = f[1]
		}
	}
	return devices
}

func (h ADBHost) Props(ctx context.Context, serial string) (contract.SlotCapabilities, error) {
	out, err := agent.ADB{Bin: h.Bin, Serial: serial}.Shell(ctx, "getprop")
	if err != nil {
		return contract.SlotCapabilities{}, err
	}
	return parseProps(out), nil
}

var propLine = regexp.MustCompile(`^\[([^\]]+)\]: \[(.*)\]$`)

// parseProps describes a phone without root from its getprop output.
func parseProps(out string) contract.SlotCapabilities {
	props := map[string]string{}
	for line := range strings.SplitSeq(out, "\n") {
		if m := propLine.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
			props[m[1]] = m[2]
		}
	}
	model := props["ro.product.model"]
	if maker := props["ro.product.manufacturer"]; maker != "" && !strings.HasPrefix(strings.ToLower(model), strings.ToLower(maker)) {
		model = maker + " " + model
	}
	abis := []string{}
	for abi := range strings.SplitSeq(props["ro.product.cpu.abilist"], ",") {
		if abi = strings.TrimSpace(abi); abi != "" {
			abis = append(abis, abi)
		}
	}
	return contract.SlotCapabilities{
		Model:    strings.TrimSpace(model),
		Android:  props["ro.build.version.release"],
		ABIs:     abis,
		DevTools: contract.DevToolsDebuggable,
		ADB:      true,
	}
}

func (h ADBHost) Agent(cfg agent.Config, log *slog.Logger) Agent {
	adb := agent.ADB{Bin: h.Bin, Serial: cfg.Serial}
	return agent.New(cfg, adb, agent.NewLauncher(adb), phone.New(h.Phone, adb, log).Run, log)
}

func (h ADBHost) Reset(ctx context.Context, serial, pkg string) error {
	return phone.Reset(ctx, agent.ADB{Bin: h.Bin, Serial: serial}, pkg)
}
