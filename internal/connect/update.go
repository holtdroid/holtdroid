package connect

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/kriakiku/holtdroid/internal/contract/control"
)

// Update says whether the portal serves a different build of this client
// for this computer than the one running. Builds are compared by SHA-256,
// so it works whatever version a build calls itself.
type Update struct {
	Available bool
	Platform  string
	Current   string
	Latest    string
}

func Platform() string { return runtime.GOOS + "-" + runtime.GOARCH }

// CheckUpdate asks the portal for its client builds.
func CheckUpdate(ctx context.Context, hc *http.Client, portal string) (Update, error) {
	u := Update{Platform: Platform()}
	self, err := selfPath()
	if err != nil {
		return u, err
	}
	if u.Current, err = fileSHA256(self); err != nil {
		return u, err
	}
	var m control.Manifest
	if err := getJSON(ctx, hc, strings.TrimRight(portal, "/")+"/connect/manifest.json", &m); err != nil {
		return u, err
	}
	for _, b := range m.Clients {
		if b.Platform == u.Platform {
			u.Latest = b.SHA256
		}
	}
	u.Available = u.Latest != "" && u.Latest != u.Current
	return u, nil
}

// ApplyUpdate downloads the portal's build into the cache next to the ones
// tunnel.sh fetched, checks it and points ~/.cache/holtdroid/holtdroid at
// it, which the holtdroid command links to. It returns the new binary.
func ApplyUpdate(ctx context.Context, hc *http.Client, portal string, u Update) (string, error) {
	dir, err := cacheDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "holtdroid-"+u.Latest)
	if sum, err := fileSHA256(path); err != nil || sum != u.Latest {
		if err := download(ctx, hc, strings.TrimRight(portal, "/")+"/connect/holtdroid-"+u.Platform, path, u.Latest); err != nil {
			return "", err
		}
	}
	link := filepath.Join(dir, "holtdroid")
	tmp := link + ".new"
	_ = os.Remove(tmp)
	if err := os.Symlink(path, tmp); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, link); err != nil {
		return "", err
	}
	return path, nil
}

// Restart replaces this process with path, keeping the arguments.
func Restart(path string) error {
	return syscall.Exec(path, os.Args, os.Environ())
}

func download(ctx context.Context, hc *http.Client, url, path, want string) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	res, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("download: %s", res.Status)
	}
	tmp := path + ".part"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	h := sha256.New()
	_, err = io.Copy(io.MultiWriter(f, h), res.Body)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil && hex.EncodeToString(h.Sum(nil)) != want {
		err = errors.New("the download doesn't match its checksum")
	}
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

func getJSON(ctx context.Context, hc *http.Client, url string, v any) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	res, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: %s", url, res.Status)
	}
	return json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(v)
}

func selfPath() (string, error) {
	p, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(p)
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// cacheDir is where tunnel.sh and updates keep client builds.
func cacheDir() (string, error) {
	if c := os.Getenv("XDG_CACHE_HOME"); c != "" {
		return filepath.Join(c, "holtdroid"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".cache", "holtdroid"), nil
}

// Prefs are the client's own settings, shared by all portals.
type Prefs struct {
	AutoUpdate bool `json:"autoUpdate"`
}

func prefsPath() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "holtdroid", "client.json"), nil
}

func LoadPrefs() Prefs {
	var p Prefs
	if path, err := prefsPath(); err == nil {
		if b, err := os.ReadFile(path); err == nil {
			_ = json.Unmarshal(b, &p)
		}
	}
	return p
}

func SavePrefs(p Prefs) error {
	path, err := prefsPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return writeFile(path, b)
}
