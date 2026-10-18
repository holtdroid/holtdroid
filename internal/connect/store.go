package connect

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// state is what a computer keeps per portal between runs.
type state struct {
	Portal       string    `json:"portal"`
	RefreshToken string    `json:"refreshToken,omitempty"`
	ExpiresAt    time.Time `json:"expiresAt,omitzero"`
	Published    []int     `json:"published"`
}

type store struct {
	dir string
}

// Dir is where the client keeps its key and enrollment for each portal.
func Dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "holtdroid", "connect"), nil
}

func storeFor(root, portal string) (*store, error) {
	u, err := url.Parse(portal)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("portal %q is not a URL", portal)
	}
	return &store{dir: filepath.Join(root, strings.ReplaceAll(u.Host, ":", "_"))}, nil
}

// Portals lists the portals this computer is enrolled with.
func Portals(root string) ([]string, error) {
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []string
	for _, e := range entries {
		var st state
		if b, err := os.ReadFile(filepath.Join(root, e.Name(), "state.json")); err == nil && json.Unmarshal(b, &st) == nil && st.RefreshToken != "" {
			out = append(out, st.Portal)
		}
	}
	return out, nil
}

func (s *store) load() (state, error) {
	var st state
	b, err := os.ReadFile(filepath.Join(s.dir, "state.json"))
	if errors.Is(err, os.ErrNotExist) {
		return st, nil
	}
	if err != nil {
		return st, err
	}
	return st, json.Unmarshal(b, &st)
}

func (s *store) save(st state) error {
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	return writeFile(filepath.Join(s.dir, "state.json"), b)
}

func writeFile(path string, b []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// key is the computer's own key for this portal, made on first use. It is
// never one of the user's ~/.ssh keys.
func (s *store) key() (ssh.Signer, error) {
	path := filepath.Join(s.dir, "id_ed25519")
	b, err := os.ReadFile(path)
	if err == nil {
		return ssh.ParsePrivateKey(b)
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	block, err := ssh.MarshalPrivateKey(priv, "holtdroid-connect")
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return nil, err
	}
	if err := writeFile(path, pem.EncodeToMemory(block)); err != nil {
		return nil, err
	}
	return ssh.NewSignerFromKey(priv)
}

// errEnrollment means the portal no longer accepts this computer and only a
// new command from the portal helps.
var errEnrollment = errors.New("enrollment rejected")

func post[T any](ctx context.Context, portal, path string, in any) (T, error) {
	var out T
	body, err := json.Marshal(in)
	if err != nil {
		return out, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(portal, "/")+path, bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return out, err
	}
	defer res.Body.Close()
	b, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return out, err
	}
	if res.StatusCode != http.StatusOK {
		var problem struct {
			Detail string `json:"detail"`
		}
		_ = json.Unmarshal(b, &problem)
		msg := problem.Detail
		if msg == "" {
			msg = res.Status
		}
		if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusUnprocessableEntity {
			return out, fmt.Errorf("%w: %s", errEnrollment, msg)
		}
		return out, fmt.Errorf("portal: %s", msg)
	}
	return out, json.Unmarshal(b, &out)
}
