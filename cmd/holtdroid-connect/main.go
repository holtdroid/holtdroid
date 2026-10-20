package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	"github.com/spf13/cobra"

	"golang.org/x/term"

	"github.com/holtdroid/holtdroid/internal/connect"
	"github.com/holtdroid/holtdroid/internal/connect/tui"
	"github.com/holtdroid/holtdroid/internal/contract/control"
)

func main() {
	if err := root().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "holtdroid:", err)
		os.Exit(1)
	}
}

func root() *cobra.Command {
	var (
		portal   string
		publish  string
		mode     string
		noADB    bool
		verbose  bool
		plain    bool
		noCheck  bool
		insecure bool
	)
	cmd := &cobra.Command{
		Use:   "holtdroid [code]",
		Short: "Connect this computer to a Holtdroid portal: publish local ports on your devices and reach their ADB",
		Long: "Run the command from the portal's Computers page once; it enrolls this computer with the code in it.\n" +
			"After that, holtdroid alone reconnects with the saved enrollment.",
		Args:          cobra.MaximumNArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			level := slog.LevelInfo
			if verbose {
				level = slog.LevelDebug
			}
			interactive := !plain && term.IsTerminal(int(os.Stdin.Fd())) && term.IsTerminal(int(os.Stdout.Fd()))
			var logs tui.Log
			out := io.Writer(os.Stderr)
			if interactive {
				out = &logs
			}
			log := slog.New(newLineHandler(out, level))
			if portal == "" {
				var err error
				if portal, err = savedPortal(); err != nil {
					return err
				}
			}
			portal = strings.TrimRight(portal, "/")
			insecure = insecure || connect.SavedInsecure(portal)
			hc := connect.HTTPClient(insecure)
			opts := connect.Options{
				Portal: portal, ADBConnect: !noADB, Version: version, Log: log, Insecure: insecure,
			}
			if len(args) == 1 {
				opts.Code = args[0]
			}
			if cmd.Flags().Changed("publish") {
				ports, err := parsePorts(publish)
				if err != nil {
					return err
				}
				opts.Publish = ports
			}
			switch m := control.PublishMode(mode); m {
			case "", control.PublishManual, control.PublishDev, control.PublishAll:
				opts.Mode = m
			default:
				return fmt.Errorf("--publish-mode: %q is not manual, dev or all", mode)
			}
			ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			outdated := false
			if !noCheck {
				var err error
				outdated, err = checkUpdate(ctx, hc, opts.Portal, interactive, log)
				if errors.Is(err, tui.ErrQuit) {
					return nil
				}
				if err != nil {
					return err
				}
			}
			if !interactive {
				opts.OnChange = connect.Printer(os.Stdout)
				return connect.Run(ctx, opts)
			}
			cfg := tui.Config{Outdated: outdated, Update: func() (string, error) {
				u, err := connect.CheckUpdate(ctx, hc, opts.Portal)
				if err != nil {
					return "", err
				}
				return connect.ApplyUpdate(ctx, hc, opts.Portal, u)
			}}
			next, err := tui.Run(ctx, &logs, cfg, func(onChange func(connect.Snapshot)) (tui.Client, error) {
				opts.OnChange = onChange
				return connect.New(opts)
			})
			if err != nil || next == "" {
				return err
			}
			return connect.Restart(next)
		},
	}
	cmd.Flags().StringVar(&portal, "portal", "", "portal URL (default: the only portal this computer is enrolled with)")
	cmd.Flags().StringVar(&publish, "publish", "", "comma-separated ports to publish on your devices, replacing the saved list")
	cmd.Flags().StringVar(&mode, "publish-mode", "", "manual publishes only the ports you pick, dev also every dev server, all every listening port; remembered for the portal")
	cmd.Flags().BoolVar(&noADB, "no-adb-connect", false, "don't run adb connect for each device")
	cmd.Flags().BoolVarP(&verbose, "verbose", "v", false, "debug logging")
	cmd.Flags().BoolVar(&insecure, "insecure", false, "accept the portal's TLS certificate without checking it (self-signed portals); remembered for the portal")
	cmd.Flags().BoolVar(&noCheck, "no-update-check", false, "don't ask the portal for a newer client")
	cmd.Flags().BoolVar(&plain, "plain", false, "print status lines instead of the full-screen UI (the default without a terminal)")
	return cmd
}

func savedPortal() (string, error) {
	dir, err := connect.Dir()
	if err != nil {
		return "", err
	}
	portals, err := connect.Portals(dir)
	if err != nil {
		return "", err
	}
	switch len(portals) {
	case 0:
		return "", errors.New("this computer is not enrolled anywhere: run the command from the portal's Computers page")
	case 1:
		return portals[0], nil
	default:
		return "", fmt.Errorf("enrolled with several portals, pick one with --portal: %s", strings.Join(portals, ", "))
	}
}

func parsePorts(spec string) ([]int, error) {
	ports := []int{}
	for part := range strings.SplitSeq(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		p, err := strconv.Atoi(part)
		if err != nil || p < 1 || p > 65535 {
			return nil, fmt.Errorf("--publish: %q is not a TCP port", part)
		}
		ports = append(ports, p)
	}
	return ports, nil
}

var version = "dev"

// checkUpdate updates to the portal's client when it is newer and the user
// wants it, and starts the new one in place of this process. It reports
// whether this client stays outdated.
func checkUpdate(ctx context.Context, hc *http.Client, portal string, interactive bool, log *slog.Logger) (bool, error) {
	u, err := connect.CheckUpdate(ctx, hc, portal)
	if err != nil {
		log.Debug("update check", "err", err)
		return false, nil
	}
	if !u.Available {
		return false, nil
	}
	prefs := connect.LoadPrefs()
	update := prefs.AutoUpdate
	switch {
	case update:
	case interactive:
		choice, err := tui.AskUpdate(portal)
		if err != nil {
			return false, err
		}
		if choice.Auto != prefs.AutoUpdate {
			prefs.AutoUpdate = choice.Auto
			if err := connect.SavePrefs(prefs); err != nil {
				log.Warn("could not save the update setting", "err", err)
			}
		}
		update = choice.Update
	default:
		fmt.Fprintln(os.Stderr, "holtdroid: the portal has a newer client; this one may not work correctly. Run holtdroid in a terminal to update.")
	}
	if !update {
		return true, nil
	}
	fmt.Fprintln(os.Stderr, "holtdroid: updating to the portal's client…")
	path, err := connect.ApplyUpdate(ctx, hc, portal, u)
	if err != nil {
		fmt.Fprintln(os.Stderr, "holtdroid: the update failed, continuing with this client:", err)
		return true, nil
	}
	return false, connect.Restart(path)
}
