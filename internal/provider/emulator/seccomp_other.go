//go:build !linux

package emulator

import "github.com/containerd/nri/pkg/api"

func androidSeccomp() (*api.LinuxSeccomp, error) { return nil, nil }
