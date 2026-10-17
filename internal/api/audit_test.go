package api

import (
	"context"
	"encoding/json"
	"flag"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/provider/fake"
)

var update = flag.Bool("update", false, "rewrite golden files")

func (h *harness) waitReady(id string) {
	h.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if s, _ := h.provider.Get(context.Background(), id); s.State == contract.StateReady {
			return
		}
		if time.Now().After(deadline) {
			h.t.Fatal("fake session never got ready")
		}
		time.Sleep(time.Millisecond)
	}
}

func (h *harness) expect(code int, method, path, user, groups string, body any) {
	h.t.Helper()
	if rec := h.do(method, path, user, groups, body); rec.Code != code {
		h.t.Fatalf("%s %s: %d %s", method, path, rec.Code, rec.Body.String())
	}
}

func TestAuditEvents(t *testing.T) {
	h := newHarness(t, 2, func(c *fake.Config) { c.StepDelay = time.Millisecond })
	copyFile(t, "../apk/testdata/helloworld.apk", filepath.Join(h.apks, "hello-v2.apk"))

	v := h.create("otter")
	h.waitReady(v.ID)
	sess := "/api/v1/sessions/fake/" + v.ID
	h.expect(http.StatusUnprocessableEntity, http.MethodPost, "/api/v1/sessions", "otter", "", map[string]string{
		"source": "local", "artifactId": encodeID("hello.apk"), "provider": "fake", "location": "atlantis",
	})
	h.expect(http.StatusForbidden, http.MethodPost, sess+"/extend", "beaver", "", nil)
	h.expect(http.StatusOK, http.MethodPost, sess+"/extend", "otter", "", nil)
	h.expect(http.StatusOK, http.MethodPost, sess+"/install", "otter", "", map[string]any{"source": "local", "artifactId": encodeID("hello-v2.apk"), "keepData": true})
	h.expect(http.StatusOK, http.MethodPut, "/s/fake/"+v.ID+"/v1/network/location", "otter", "", contract.SetLocation{Location: "de"})
	h.expect(http.StatusNoContent, http.MethodPost, "/s/fake/"+v.ID+"/v1/clipboard", "otter", "", contract.Clipboard{Text: "s3cr3t-clipboard"})
	h.expect(http.StatusForbidden, http.MethodDelete, sess, "beaver", "", nil)
	h.expect(http.StatusNoContent, http.MethodDelete, sess, "root", "admins", nil)

	idle := h.create("otter")
	h.clock.Advance(31 * time.Minute)
	h.srv.Reap(context.Background())
	if _, err := h.provider.Get(context.Background(), idle.ID); err == nil {
		t.Fatal("idle session survived")
	}

	raw, _ := os.ReadFile("../apk/testdata/helloworld.apk")
	rec := h.upload("otter", "", "mine.apk", raw, map[string]string{"visibility": "private"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	up := decode[ArtifactView](t, rec)
	art := "/api/v1/artifacts/" + up.Source + "/" + up.ID
	h.expect(http.StatusNotFound, http.MethodPatch, art, "beaver", "", map[string]string{"visibility": "public"})
	h.expect(http.StatusOK, http.MethodPatch, art, "otter", "", map[string]any{"visibility": "public", "temporary": false})
	h.expect(http.StatusNoContent, http.MethodDelete, art, "root", "admins", nil)

	out := h.audit.String()
	if strings.Contains(out, "s3cr3t") {
		t.Fatal("clipboard content leaked into the audit log")
	}
	out = strings.NewReplacer(v.ID, "<session-1>", idle.ID, "<session-2>", up.ID, "<upload>").Replace(out)
	out = regexp.MustCompile(`@[0-9a-f]{16}`).ReplaceAllString(out, "@<rev>")
	out = regexp.MustCompile(`uploads/[0-9a-f]{12}/`).ReplaceAllString(out, "uploads/<rand>/")
	for line := range strings.Lines(out) {
		var ev map[string]any
		if err := json.Unmarshal([]byte(line), &ev); err != nil || ev["log"] != "audit" || ev["schema"] != float64(1) {
			t.Fatalf("not an audit line: %s", line)
		}
	}
	golden(t, "testdata/audit.golden", out)
}

func golden(t *testing.T, path, got string) {
	t.Helper()
	if *update {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != string(want) {
		t.Fatalf("%s differs (go test -update to rewrite):\n%s", path, got)
	}
}

func TestAuditSignIn(t *testing.T) {
	h, buf := cookieServerAudited(t, auth.ModePassword)
	call(h, http.MethodPost, "/api/v1/auth/login", `{"password":"wrong"}`, nil)
	rec := call(h, http.MethodPost, "/api/v1/auth/login", `{"password":"hunter2"}`, nil)
	call(h, http.MethodPost, "/api/v1/auth/logout", "", rec.Result().Cookies())

	var got []string
	for line := range strings.Lines(buf.String()) {
		var ev struct {
			Action, Result, Actor, ClientIP string
			Details                         map[string]string
		}
		_ = json.Unmarshal([]byte(line), &ev)
		got = append(got, strings.Join([]string{ev.Action, ev.Result, ev.Details["method"], ev.ClientIP}, "|"))
	}
	want := []string{"auth.signin|denied|password|192.0.2.1", "auth.signin|ok|password|192.0.2.1", "auth.signout|ok||192.0.2.1"}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("events %q, want %q", got, want)
	}
}
