package connect

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInstallCommand(t *testing.T) {
	home := t.TempDir()
	bin := filepath.Join(home, ".local", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	cache := filepath.Join(home, "cache")
	stable := filepath.Join(cache, "holtdroid", "holtdroid")
	if err := os.MkdirAll(filepath.Dir(stable), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stable, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("XDG_CACHE_HOME", cache)
	t.Setenv("PATH", strings.Join([]string{"/nonexistent", bin}, string(os.PathListSeparator)))

	plan, err := InstallPlan()
	if err != nil || plan.Installed || plan.Path != filepath.Join(bin, "holtdroid") || plan.Target != stable || !plan.InPath {
		t.Fatalf("plan %+v, %v", plan, err)
	}
	got, err := InstallCommand()
	if err != nil || !got.Installed {
		t.Fatalf("install %+v, %v", got, err)
	}
	if dest, _ := os.Readlink(got.Path); dest != stable {
		t.Fatalf("link points at %q", dest)
	}
	if again, err := InstallCommand(); err != nil || !again.Installed {
		t.Fatalf("second install %+v, %v", again, err)
	}

	if err := os.Remove(got.Path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(got.Path, []byte("someone else's"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallCommand(); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("replaced a file that isn't ours: %v", err)
	}

	t.Setenv("PATH", "/nonexistent")
	if err := os.Remove(got.Path); err != nil {
		t.Fatal(err)
	}
	plan, err = InstallPlan()
	if err != nil || plan.InPath || plan.Path != filepath.Join(bin, "holtdroid") {
		t.Fatalf("plan without PATH %+v, %v", plan, err)
	}
}
