package connect

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// Install describes the `holtdroid` command on the user's PATH.
type Install struct {
	// Path is where the command is or would be linked.
	Path string
	// Target is the binary it runs: the link tunnel.sh keeps pointing at
	// the newest download, or this binary when that link doesn't exist.
	Target    string
	Installed bool
	// InPath is false when Path's directory is not on PATH yet.
	InPath bool
}

// InstallPlan finds where `holtdroid` would go: the first writable
// directory of ~/.local/bin, ~/bin, /opt/homebrew/bin and /usr/local/bin
// that is on PATH, else ~/.local/bin.
func InstallPlan() (Install, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Install{}, err
	}
	target, err := clientTarget()
	if err != nil {
		return Install{}, err
	}
	path := filepath.SplitList(os.Getenv("PATH"))
	candidates := []string{filepath.Join(home, ".local", "bin"), filepath.Join(home, "bin"), "/opt/homebrew/bin", "/usr/local/bin"}
	for _, dir := range candidates {
		link := filepath.Join(dir, "holtdroid")
		if ours(link, target) {
			return Install{Path: link, Target: target, Installed: true, InPath: slices.Contains(path, dir)}, nil
		}
	}
	for _, dir := range candidates {
		if slices.Contains(path, dir) && writable(dir) {
			return Install{Path: filepath.Join(dir, "holtdroid"), Target: target, InPath: true}, nil
		}
	}
	dir := candidates[0]
	return Install{Path: filepath.Join(dir, "holtdroid"), Target: target, InPath: slices.Contains(path, dir)}, nil
}

// InstallCommand links `holtdroid` as InstallPlan says. It never replaces
// a file that isn't a link to this client.
func InstallCommand() (Install, error) {
	plan, err := InstallPlan()
	if err != nil || plan.Installed {
		return plan, err
	}
	if _, err := os.Lstat(plan.Path); err == nil {
		return plan, fmt.Errorf("%s already exists and is not this client", plan.Path)
	}
	if err := os.MkdirAll(filepath.Dir(plan.Path), 0o755); err != nil {
		return plan, err
	}
	if err := os.Symlink(plan.Target, plan.Path); err != nil {
		return plan, err
	}
	plan.Installed = true
	return plan, nil
}

func clientTarget() (string, error) {
	cache, err := cacheDir()
	if err != nil {
		return "", err
	}
	stable := filepath.Join(cache, "holtdroid")
	if _, err := os.Stat(stable); err == nil {
		return stable, nil
	}
	self, err := os.Executable()
	if err != nil {
		return "", errors.New("can't tell where this client is")
	}
	return self, nil
}

func ours(link, target string) bool {
	dest, err := os.Readlink(link)
	if err != nil {
		return false
	}
	if !filepath.IsAbs(dest) {
		dest = filepath.Join(filepath.Dir(link), dest)
	}
	return filepath.Clean(dest) == filepath.Clean(target) || strings.Contains(filepath.Base(dest), "holtdroid-")
}

func writable(dir string) bool {
	f, err := os.CreateTemp(dir, ".holtdroid-*")
	if err != nil {
		return false
	}
	name := f.Name()
	f.Close()
	_ = os.Remove(name)
	return true
}
