package phone

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

// App is the Holtdroid Tunnel APK every phone gets: the VPN, the device
// owner when an operator provisioned it, and the wallpaper.
type App struct {
	APK     string
	Version string
}

// AppADB is what managing the app needs from adb.
type AppADB interface {
	Shell(ctx context.Context, cmd string) (string, error)
	Install(ctx context.Context, apk string) error
}

type ownerStatus struct {
	DeviceOwner bool `json:"device_owner"`
}

// Ensure installs the app when it is missing or another version. A build
// signed with another key replaces it unless the app is the device owner,
// which only an APK with the same key may update.
func (a App) Ensure(ctx context.Context, adb AppADB) error {
	if a.APK == "" {
		return nil
	}
	st, _, err := broadcast(ctx, adb, "STATUS", "")
	if err == nil && (a.Version == "" || st.Version == a.Version) {
		return nil
	}
	err = adb.Install(ctx, a.APK)
	if err == nil || !strings.Contains(err.Error(), "INSTALL_FAILED_UPDATE_INCOMPATIBLE") {
		return wrap("install the tunnel app", err)
	}
	if st.Owner.DeviceOwner {
		return errors.New("the tunnel app is the device owner and the new APK is signed with another key")
	}
	if _, err := adb.Shell(ctx, "pm uninstall "+TunnelPackage); err != nil {
		return err
	}
	return wrap("install the tunnel app", adb.Install(ctx, a.APK))
}

func wrap(what string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", what, err)
}

// Owner reports whether the app is the device owner.
func Owner(ctx context.Context, adb Shell) bool {
	st, _, err := broadcast(ctx, adb, "STATUS", "")
	return err == nil && st.Owner.DeviceOwner
}

// kioskFeatures leave the power menu out: no reboots or power-off from a
// session. Emergency calls still go through the dialer.
const kioskFeatures = "system_info,notifications,home,overview"

// StartSession launches pkg in lock task: users switch between allowed
// apps and go home, but can't open Settings, stores or the power menu.
func StartSession(ctx context.Context, adb Shell, pkg string) error {
	if !packageName.MatchString(pkg) {
		return fmt.Errorf("bad package name %q", pkg)
	}
	st, code, err := broadcast(ctx, adb, "SESSION_START", "--es package "+pkg+" --es features "+kioskFeatures)
	switch {
	case err != nil:
		return err
	case code != -1:
		return fmt.Errorf("start the kiosk: %s", st.Error)
	}
	return nil
}

// ownerActions run after every cleanup on a device owner: end the kiosk,
// remove a PIN someone set and put the lockdown back.
func ownerActions(ctx context.Context, adb Shell) error {
	var errs []error
	for _, action := range []string{"SESSION_END", "CLEAR_PASSWORD", "LOCKDOWN"} {
		st, code, err := broadcast(ctx, adb, action, "")
		switch {
		case err != nil:
			errs = append(errs, fmt.Errorf("%s: %w", action, err))
		case code != -1:
			errs = append(errs, fmt.Errorf("%s: %s", action, st.Error))
		}
	}
	return errors.Join(errs...)
}

// SetWallpaper draws Holtdroid's wallpaper with rows, the JSON of
// agent.Wallpaper.
func SetWallpaper(ctx context.Context, adb Shell, rows []byte) error {
	st, code, err := broadcast(ctx, adb, "WALLPAPER", "--es rows_b64 "+base64.StdEncoding.EncodeToString(rows))
	switch {
	case err != nil:
		return err
	case code != -1:
		return fmt.Errorf("set the wallpaper: %s", st.Error)
	}
	return nil
}
