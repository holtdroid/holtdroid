package emulator

import (
	"github.com/containerd/nri/pkg/api"
	"github.com/moby/profiles/seccomp"
	specs "github.com/opencontainers/runtime-spec/specs-go"
)

func androidSeccomp() (*api.LinuxSeccomp, error) {
	caps := make([]string, len(androidCapabilities))
	for i, c := range androidCapabilities {
		caps[i] = "CAP_" + string(c)
	}
	sp, err := seccomp.GetDefaultProfile(&specs.Spec{Process: &specs.Process{Capabilities: &specs.LinuxCapabilities{Bounding: caps}}})
	if err != nil {
		return nil, err
	}
	sp.Syscalls = append(sp.Syscalls, specs.LinuxSyscall{Names: []string{"userfaultfd"}, Action: specs.ActAllow})
	return api.FromOCILinuxSeccomp(sp), nil
}
