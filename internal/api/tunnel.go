package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"text/template"
	"time"
)

var clientName = regexp.MustCompile(`^holtdroid-(darwin|linux)-(amd64|arm64)$`)

type connectClient struct {
	Platform string
	SHA256   string
	size     int64
	modTime  time.Time
}

// connectClients hashes the client builds once per file version.
type connectClients struct {
	mu    sync.Mutex
	known map[string]connectClient
}

func (cc *connectClients) list(dir string) []connectClient {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	cc.mu.Lock()
	defer cc.mu.Unlock()
	if cc.known == nil {
		cc.known = map[string]connectClient{}
	}
	var out []connectClient
	for _, e := range entries {
		m := clientName.FindStringSubmatch(e.Name())
		info, err := e.Info()
		if m == nil || err != nil || !info.Mode().IsRegular() {
			continue
		}
		c, ok := cc.known[e.Name()]
		if !ok || c.size != info.Size() || !c.modTime.Equal(info.ModTime()) {
			f, err := os.Open(filepath.Join(dir, e.Name()))
			if err != nil {
				continue
			}
			h := sha256.New()
			_, err = io.Copy(h, f)
			f.Close()
			if err != nil {
				continue
			}
			c = connectClient{Platform: m[1] + "-" + m[2], SHA256: hex.EncodeToString(h.Sum(nil)), size: info.Size(), modTime: info.ModTime()}
			cc.known[e.Name()] = c
		}
		out = append(out, c)
	}
	return out
}

var tunnelScript = template.Must(template.New("tunnel.sh").Parse(`#!/bin/sh
# Holtdroid connect: downloads the client for this computer and runs it.
set -eu
portal='{{.Portal}}'
case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "holtdroid: $(uname -s) is not supported yet" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "holtdroid: $(uname -m) is not supported yet" >&2; exit 1 ;;
esac
case "$os-$arch" in
{{- range .Clients}}
  {{.Platform}}) sum={{.SHA256}} ;;
{{- end}}
  *) echo "holtdroid: this portal has no client for $os-$arch" >&2; exit 1 ;;
esac
dir="${XDG_CACHE_HOME:-$HOME/.cache}/holtdroid"
bin="$dir/holtdroid-$sum"
if [ ! -x "$bin" ]; then
  mkdir -p "$dir"
  tmp="$bin.$$"
  curl -fsSL "$portal/connect/holtdroid-$os-$arch" -o "$tmp"
  if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp"); else got=$(shasum -a 256 "$tmp"); fi
  if [ "${got%% *}" != "$sum" ]; then rm -f "$tmp"; echo "holtdroid: the download doesn't match its checksum" >&2; exit 1; fi
  chmod 755 "$tmp"
  mv "$tmp" "$bin"
fi
ln -sf "$bin" "$dir/holtdroid"
echo "holtdroid: next time run $dir/holtdroid to reconnect without a new code" >&2
if (: </dev/tty) 2>/dev/null; then
  exec "$bin" --portal "$portal" "$@" </dev/tty
fi
exec "$bin" --portal "$portal" "$@"
`))

func (s *Server) portalURL(r *http.Request) string {
	if s.cfg.PublicURL != "" {
		return strings.TrimRight(s.cfg.PublicURL, "/")
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

var safeURL = regexp.MustCompile(`^https?://[A-Za-z0-9.\-:\[\]]+(/[A-Za-z0-9._~/\-]*)?$`)

func (s *Server) serveTunnelScript(w http.ResponseWriter, r *http.Request) {
	if s.ca == nil {
		http.NotFound(w, r)
		return
	}
	portal := s.portalURL(r)
	if !safeURL.MatchString(portal) {
		http.Error(w, "unexpected portal address", http.StatusBadRequest)
		return
	}
	var b bytes.Buffer
	err := tunnelScript.Execute(&b, struct {
		Portal  string
		Clients []connectClient
	}{portal, s.clients.list(s.cfg.SSH.ClientDir)})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(b.Bytes())
}

func (s *Server) serveConnectClient(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	if s.ca == nil || !clientName.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, filepath.Join(s.cfg.SSH.ClientDir, name))
}
