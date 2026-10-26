package agent

import (
	"context"
	"strings"
)

// chromeFlags skip Chrome's and Chromium's welcome screens. Builds of a
// userdebug image or a debug app read /data/local/tmp, the rest /data/local.
var chromeFlags = []string{"_", "--disable-fre", "--no-default-browser-check", "--disable-search-engine-choice-screen"}

func (a *Agent) installApp(ctx context.Context, apk string) error {
	if err := a.dev.Install(ctx, apk); err != nil {
		return err
	}
	a.browserDefaults(ctx)
	return nil
}

func (a *Agent) browserDefaults(ctx context.Context) {
	line := strings.Join(chromeFlags, " ")
	for _, dir := range []string{"/data/local/tmp", "/data/local"} {
		file := dir + "/chrome-command-line"
		if _, err := a.dev.Shell(ctx, "echo '"+line+"' > "+file+" && chmod 644 "+file); err != nil {
			a.log.Debug("chrome command line", "file", file, "err", err)
		}
	}
	if _, err := a.dev.Shell(ctx, "cmd role add-role-holder --user 0 android.app.role.BROWSER "+a.cfg.Package); err != nil {
		a.log.Debug("default browser", "package", a.cfg.Package, "err", err)
	}
}
