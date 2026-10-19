package connect

import (
	"context"
	"errors"
	"net/url"
	"os/exec"
	"runtime"
	"strings"

	"github.com/kriakiku/holtdroid/internal/contract/control"
)

// SessionURL is the session's page in the portal.
func (cl *Client) SessionURL(s control.Session) string {
	return strings.TrimRight(cl.opts.Portal, "/") + "/session/" + url.PathEscape(s.Provider) + "/" + url.PathEscape(s.ID)
}

// InspectURL lists the WebViews of every device in adb devices.
const InspectURL = "chrome://inspect/#devices"

// OpenInspect opens InspectURL in Chrome; the system's URL opener doesn't
// handle chrome:// links.
func OpenInspect() error {
	ctx := context.Background()
	if runtime.GOOS == "darwin" {
		return exec.CommandContext(ctx, "open", "-a", "Google Chrome", InspectURL).Run()
	}
	for _, name := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser"} {
		if path, err := exec.LookPath(name); err == nil {
			return exec.CommandContext(ctx, path, InspectURL).Start()
		}
	}
	return errors.New("no Chrome on PATH")
}

// OpenURL opens u in the computer's browser.
func OpenURL(u string) error {
	name := "xdg-open"
	if runtime.GOOS == "darwin" {
		name = "open"
	}
	return exec.CommandContext(context.Background(), name, u).Start()
}
