package emulator

import (
	"slices"
	"testing"
)

func TestAndroidSeccomp(t *testing.T) {
	sp, err := androidSeccomp()
	if err != nil {
		t.Fatal(err)
	}
	if sp.DefaultAction != "SCMP_ACT_ERRNO" {
		t.Errorf("default action = %s, want SCMP_ACT_ERRNO", sp.DefaultAction)
	}
	allowed := map[string]bool{}
	for _, sc := range sp.Syscalls {
		if sc.Action == "SCMP_ACT_ALLOW" && len(sc.Args) == 0 {
			for _, n := range sc.Names {
				allowed[n] = true
			}
		}
	}
	for _, name := range []string{"userfaultfd", "mount", "bpf", "ptrace", "reboot"} {
		if !allowed[name] {
			t.Errorf("%s isn't allowed", name)
		}
	}
	for _, name := range []string{"kexec_load", "init_module", "keyctl", "clock_settime", "io_uring_setup"} {
		if allowed[name] {
			t.Errorf("%s is allowed", name)
		}
	}
	if !slices.Contains(sp.Architectures, "SCMP_ARCH_X86_64") && !slices.Contains(sp.Architectures, "SCMP_ARCH_AARCH64") {
		t.Errorf("architectures = %v", sp.Architectures)
	}
}
