package emulator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

const annotationImageDigest = "holtdroid/session-image-digest"

// Prepull keeps the session image cached on the nodes: when the image's tag
// moves to a new digest, the prepull DaemonSet is restarted so its pods pull
// it before the next session needs it.
type Prepull struct {
	Refresh   bool
	DaemonSet string
	Interval  time.Duration
}

func (c Prepull) active(pullPolicy string) bool {
	return c.Refresh && c.DaemonSet != "" && corev1.PullPolicy(pullPolicy) == corev1.PullAlways
}

// RefreshPrepull watches the session image until ctx ends.
func (p *Provider) RefreshPrepull(ctx context.Context) {
	if !p.cfg.Prepull.active(p.cfg.ImagePullPolicy) {
		return
	}
	if _, _, ok := splitImage(p.cfg.Image); !ok {
		p.log.Info("prepull refresh is off: the session image is pinned by digest", "image", p.cfg.Image)
		return
	}
	t := time.NewTicker(p.cfg.Prepull.Interval)
	defer t.Stop()
	for {
		if err := p.refreshPrepull(ctx); err != nil && ctx.Err() == nil {
			p.log.Warn("prepull refresh", "image", p.cfg.Image, "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (p *Provider) refreshPrepull(ctx context.Context) error {
	digest, err := p.registry.digest(ctx, p.cfg.Image)
	if err != nil {
		return err
	}
	ds, err := p.kube.AppsV1().DaemonSets(p.cfg.Namespace).Get(ctx, p.cfg.Prepull.DaemonSet, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("get daemonset: %w", err)
	}
	if ds.Spec.Template.Annotations[annotationImageDigest] == digest {
		return nil
	}
	patch := fmt.Appendf(nil, `{"spec":{"template":{"metadata":{"annotations":{%q:%q}}}}}`, annotationImageDigest, digest)
	if _, err := p.kube.AppsV1().DaemonSets(p.cfg.Namespace).Patch(ctx, ds.Name, types.MergePatchType, patch, metav1.PatchOptions{}); err != nil {
		return fmt.Errorf("patch daemonset: %w", err)
	}
	p.log.Info("session image changed, pulling it onto the nodes", "image", p.cfg.Image, "digest", digest)
	return nil
}

// registry resolves image tags with the OCI distribution API, signing in
// anonymously when the registry asks for a bearer token.
type registry struct {
	hc   *http.Client
	base func(host string) string
}

func newRegistry() *registry {
	return &registry{hc: &http.Client{Timeout: 30 * time.Second}, base: func(host string) string { return "https://" + host }}
}

// splitImage returns the registry host and repository path ("v2/<name>/manifests/<tag>"
// without the prefix); ok is false for references pinned by digest.
func splitImage(image string) (host, manifest string, ok bool) {
	if strings.Contains(image, "@") {
		return "", "", false
	}
	name, tag := image, "latest"
	if i := strings.LastIndex(image, ":"); i > strings.LastIndex(image, "/") {
		name, tag = image[:i], image[i+1:]
	}
	host, repo, found := strings.Cut(name, "/")
	if !found || !strings.ContainsAny(host, ".:") && host != "localhost" {
		host, repo = "registry-1.docker.io", name
		if !strings.Contains(repo, "/") {
			repo = "library/" + repo
		}
	}
	if host == "docker.io" {
		host = "registry-1.docker.io"
	}
	return host, repo + "/manifests/" + tag, true
}

var manifestTypes = strings.Join([]string{
	"application/vnd.oci.image.index.v1+json",
	"application/vnd.docker.distribution.manifest.list.v2+json",
	"application/vnd.oci.image.manifest.v1+json",
	"application/vnd.docker.distribution.manifest.v2+json",
}, ", ")

func (r *registry) digest(ctx context.Context, image string) (string, error) {
	host, manifest, ok := splitImage(image)
	if !ok {
		return "", fmt.Errorf("%s is pinned by digest", image)
	}
	target := r.base(host) + "/v2/" + manifest
	status, header, err := r.head(ctx, target, "")
	if err != nil {
		return "", err
	}
	if status == http.StatusUnauthorized {
		token, err := r.token(ctx, header.Get("WWW-Authenticate"))
		if err != nil {
			return "", err
		}
		if status, header, err = r.head(ctx, target, token); err != nil {
			return "", err
		}
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("manifest %s: %d %s", image, status, http.StatusText(status))
	}
	digest := header.Get("Docker-Content-Digest")
	if digest == "" {
		return "", fmt.Errorf("manifest %s: no Docker-Content-Digest", image)
	}
	return digest, nil
}

func (r *registry) head(ctx context.Context, target, token string) (int, http.Header, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, target, nil)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Accept", manifestTypes)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := r.hc.Do(req)
	if err != nil {
		return 0, nil, err
	}
	resp.Body.Close()
	return resp.StatusCode, resp.Header, nil
}

func (r *registry) token(ctx context.Context, challenge string) (string, error) {
	scheme, params, _ := strings.Cut(challenge, " ")
	if !strings.EqualFold(scheme, "Bearer") {
		return "", fmt.Errorf("registry wants %q auth; only anonymous bearer tokens are supported", scheme)
	}
	p := parseChallenge(params)
	if p["realm"] == "" {
		return "", errors.New("registry auth challenge has no realm")
	}
	u, err := url.Parse(p["realm"])
	if err != nil {
		return "", fmt.Errorf("registry auth realm: %w", err)
	}
	q := u.Query()
	for _, k := range []string{"service", "scope"} {
		if p[k] != "" {
			q.Set(k, p[k])
		}
	}
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", err
	}
	resp, err := r.hc.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("registry token: %s", resp.Status)
	}
	var out struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		return "", fmt.Errorf("registry token: %w", err)
	}
	if out.Token == "" && out.AccessToken == "" {
		return "", errors.New("registry token: empty")
	}
	if out.Token != "" {
		return out.Token, nil
	}
	return out.AccessToken, nil
}

// parseChallenge reads `realm="…",service="…",scope="…"`; values are quoted
// and may contain commas.
func parseChallenge(s string) map[string]string {
	out := map[string]string{}
	for s != "" {
		key, rest, ok := strings.Cut(strings.TrimLeft(s, " ,"), "=")
		if !ok {
			break
		}
		var val string
		if strings.HasPrefix(rest, `"`) {
			end := strings.Index(rest[1:], `"`)
			if end < 0 {
				val, rest = rest[1:], ""
			} else {
				val, rest = rest[1:end+1], rest[end+2:]
			}
		} else {
			val, rest, _ = strings.Cut(rest, ",")
		}
		out[strings.ToLower(strings.TrimSpace(key))] = val
		s = rest
	}
	return out
}
