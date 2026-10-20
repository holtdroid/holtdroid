package emulator

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestSplitImage(t *testing.T) {
	for _, tc := range []struct {
		image, host, manifest string
		ok                    bool
	}{
		{"ghcr.io/holtdroid/holtdroid-session:main", "ghcr.io", "holtdroid/holtdroid-session/manifests/main", true},
		{"registry.local:5000/team/session", "registry.local:5000", "team/session/manifests/latest", true},
		{"localhost/session:dev", "localhost", "session/manifests/dev", true},
		{"ubuntu:24.04", "registry-1.docker.io", "library/ubuntu/manifests/24.04", true},
		{"kriakiku/session:main", "registry-1.docker.io", "kriakiku/session/manifests/main", true},
		{"docker.io/kriakiku/session:main", "registry-1.docker.io", "kriakiku/session/manifests/main", true},
		{"ghcr.io/holtdroid/holtdroid-session@sha256:abc", "", "", false},
	} {
		host, manifest, ok := splitImage(tc.image)
		if host != tc.host || manifest != tc.manifest || ok != tc.ok {
			t.Errorf("%s: %q %q %v", tc.image, host, manifest, ok)
		}
	}
}

func TestParseChallenge(t *testing.T) {
	got := parseChallenge(`realm="https://ghcr.io/token",service="ghcr.io",scope="repository:a/b:pull,push"`)
	if got["realm"] != "https://ghcr.io/token" || got["service"] != "ghcr.io" || got["scope"] != "repository:a/b:pull,push" {
		t.Fatalf("%v", got)
	}
}

// fakeRegistry hands out an anonymous token and serves one tag whose digest
// the test can move.
type fakeRegistry struct {
	mu     sync.Mutex
	digest string
	heads  int
}

func (f *fakeRegistry) serve(t *testing.T) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	mux := http.NewServeMux()
	mux.HandleFunc("GET /token", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("scope") != "repository:holtdroid/holtdroid-session:pull" && r.URL.Query().Get("scope") != "repository:holtdroid/holtdroid-redroid:pull" || r.URL.Query().Get("service") != "registry" {
			http.Error(w, "bad scope", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"token": "anon"})
	})
	mux.HandleFunc("HEAD /v2/holtdroid/{repo}/manifests/main", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.heads++
		if r.Header.Get("Authorization") != "Bearer anon" {
			w.Header().Set("WWW-Authenticate", `Bearer realm="`+srv.URL+`/token",service="registry",scope="repository:holtdroid/`+r.PathValue("repo")+`:pull"`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if !strings.Contains(r.Header.Get("Accept"), "application/vnd.oci.image.index.v1+json") {
			w.WriteHeader(http.StatusNotAcceptable)
			return
		}
		w.Header().Set("Docker-Content-Digest", f.digest)
	})
	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func (f *fakeRegistry) set(digest string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.digest = digest
}

func TestRefreshPrepull(t *testing.T) {
	kube := cluster()
	ds := &appsv1.DaemonSet{Name: "holtdroid-session-prepull", Namespace: "holtdroid"}
	if _, err := kube.AppsV1().DaemonSets("holtdroid").Create(context.Background(), ds, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	reg := &fakeRegistry{digest: "sha256:one"}
	srv := reg.serve(t)
	p := newProvider(t, kube, func(c *Config) {
		c.ImagePullPolicy = "Always"
		c.Prepull.DaemonSet = "holtdroid-session-prepull"
	})
	p.log = slog.New(slog.DiscardHandler)
	p.registry.base = func(string) string { return srv.URL }
	ctx := context.Background()

	annotation := func() string {
		t.Helper()
		got, err := kube.AppsV1().DaemonSets("holtdroid").Get(ctx, ds.Name, metav1.GetOptions{})
		if err != nil {
			t.Fatal(err)
		}
		return got.Spec.Template.Annotations[annotationImageDigest]
	}
	patches := func() int {
		n := 0
		for _, a := range kube.Actions() {
			if a.GetVerb() == "patch" && a.GetResource().Resource == "daemonsets" {
				n++
			}
		}
		return n
	}

	for _, step := range []struct {
		digest  string
		patches int
	}{
		{"sha256:one", 1},
		{"sha256:one", 1},
		{"sha256:two", 2},
	} {
		reg.set(step.digest)
		if err := p.refreshPrepull(ctx); err != nil {
			t.Fatal(err)
		}
		if got, want := annotation(), step.digest+","+step.digest; got != want {
			t.Fatalf("annotation %q, want %q", got, want)
		}
		if got := patches(); got != step.patches {
			t.Fatalf("after %s: %d patches, want %d", step.digest, got, step.patches)
		}
	}
}

func TestPrepullActive(t *testing.T) {
	on := Prepull{Refresh: true, DaemonSet: "ds"}
	for _, tc := range []struct {
		cfg    Prepull
		policy string
		want   bool
	}{
		{on, "Always", true},
		{on, "IfNotPresent", false},
		{Prepull{Refresh: false, DaemonSet: "ds"}, "Always", false},
		{Prepull{Refresh: true}, "Always", false},
	} {
		if got := tc.cfg.active(tc.policy); got != tc.want {
			t.Errorf("%+v %s: %v", tc.cfg, tc.policy, got)
		}
	}
}
