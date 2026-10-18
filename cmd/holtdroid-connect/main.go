package main

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/kriakiku/holtdroid/internal/connect"
)

func main() {
	if err := root().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "holtdroid:", err)
		os.Exit(1)
	}
}

func root() *cobra.Command {
	var (
		portal  string
		publish string
		noADB   bool
		verbose bool
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
			log := slog.New(newLineHandler(os.Stderr, level))
			if portal == "" {
				var err error
				if portal, err = savedPortal(); err != nil {
					return err
				}
			}
			opts := connect.Options{
				Portal: strings.TrimRight(portal, "/"), ADBConnect: !noADB, Version: version, Out: os.Stdout, Log: log,
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
			ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			return connect.Run(ctx, opts)
		},
	}
	cmd.Flags().StringVar(&portal, "portal", "", "portal URL (default: the only portal this computer is enrolled with)")
	cmd.Flags().StringVar(&publish, "publish", "", "comma-separated ports to publish on your devices, replacing the saved list")
	cmd.Flags().BoolVar(&noADB, "no-adb-connect", false, "don't run adb connect for each device")
	cmd.Flags().BoolVarP(&verbose, "verbose", "v", false, "debug logging")
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
