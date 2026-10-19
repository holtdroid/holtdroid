package agent

import (
	"context"
	"io"
	"strings"
)

// suQuote wraps s in single quotes so su runs it as one command; callers
// build these strings in code, not from user input.
func suQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// suWrap runs cmd as root through Magisk's su. It is the one place the agent
// escalates on a phone; a later hardening step replaces it with a privileged
// helper reachable only through the agent (architecture.md, layer 3).
func suWrap(cmd string) string {
	return "su -c " + suQuote(cmd)
}

// suDevice runs a phone's shell as root through su, so code written for the
// emulator's root adbd (device controls, app data) works unchanged. Pushes
// stay as the shell user, which can already write /data/local/tmp.
type suDevice struct {
	Device
	ad appDataDevice
}

func (d suDevice) Shell(ctx context.Context, cmd string) (string, error) {
	return d.Device.Shell(ctx, suWrap(cmd))
}

func (d suDevice) ExecOut(ctx context.Context, cmd string, w io.Writer) error {
	return d.ad.ExecOut(ctx, suWrap(cmd), w)
}

func (d suDevice) Push(ctx context.Context, local, remote string) error {
	return d.ad.Push(ctx, local, remote)
}
