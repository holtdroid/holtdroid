package config

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

type nested struct {
	IdleTimeout time.Duration
	MaxSize     ByteSize
}

type endpoint struct {
	Name string
	URL  string
}

type sample struct {
	Listen    string
	Sessions  nested
	Groups    []string
	Endpoints []endpoint
}

func TestLoad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "c.yaml")
	yaml := "listen: \":9000\"\nsessions:\n  idleTimeout: 45m\nendpoints:\n  - name: slack\n    url: http://slack\n"
	if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOLTDROID_SESSIONS__MAXSIZE", "2GiB")
	t.Setenv("HOLTDROID_GROUPS", "a,b")

	defaults := sample{Listen: ":8080", Sessions: nested{IdleTimeout: 30 * time.Minute, MaxSize: 1}}
	var got sample
	if err := Load(path, defaults, &got); err != nil {
		t.Fatal(err)
	}
	want := sample{
		Listen:    ":9000",
		Sessions:  nested{IdleTimeout: 45 * time.Minute, MaxSize: 2 << 30},
		Groups:    []string{"a", "b"},
		Endpoints: []endpoint{{Name: "slack", URL: "http://slack"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

func TestLoadDefaultsOnly(t *testing.T) {
	var got sample
	if err := Load("", sample{Listen: ":8080"}, &got); err != nil {
		t.Fatal(err)
	}
	if got.Listen != ":8080" {
		t.Fatalf("listen = %q", got.Listen)
	}
}
