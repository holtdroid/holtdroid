package connect

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kriakiku/holtdroid/internal/adbproto"
	"github.com/kriakiku/holtdroid/internal/api"
	"github.com/kriakiku/holtdroid/internal/audit"
	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/contract/control"
	"github.com/kriakiku/holtdroid/internal/provider/fake"
	"github.com/kriakiku/holtdroid/internal/sshgateway"
)

type portal struct {
	t        *testing.T
	url      string
	ui       http.Handler
	provider *fake.Provider
}

func newPortal(t *testing.T) *portal {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	log := slog.New(slog.DiscardHandler)

	tunnels := httptest.NewServer(nil)
	t.Cleanup(tunnels.Close)
	agents := httptest.NewServer(nil)
	t.Cleanup(agents.Close)
	p := fake.New(fake.Config{Slots: 4, StepDelay: time.Millisecond, PublicURL: agents.URL, TunnelURL: tunnels.URL})
	tunnels.Config.Handler = p.TunnelHandler()
	agents.Config.Handler = p.AgentHandler()

	var lc net.ListenConfig
	sshLn, err := lc.Listen(ctx, "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	gatewayAPI := httptest.NewUnstartedServer(nil)
	gatewayAPI.Start()
	t.Cleanup(gatewayAPI.Close)
	ui := httptest.NewUnstartedServer(nil)
	ui.Start()
	t.Cleanup(ui.Close)

	cfg := api.DefaultConfig()
	cfg.PublicURL = ui.URL
	cfg.Storage.Filesystem.Dir = t.TempDir()
	cfg.Sources[0].Filesystem.Dir = t.TempDir()
	apkData, err := os.ReadFile("../apk/testdata/helloworld.apk")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cfg.Sources[0].Filesystem.Dir, "helloworld.apk"), apkData, 0o644); err != nil {
		t.Fatal(err)
	}
	cfg.Auth.Mode = auth.ModeHeader
	cfg.SSH.Enabled = true
	cfg.SSH.GatewayURL = gatewayAPI.URL
	cfg.SSH.PublicHost = "127.0.0.1"
	cfg.SSH.PublicPort = sshLn.Addr().(*net.TCPAddr).Port
	aud, err := audit.New(ctx, audit.Config{}, "api", "test", nil, audit.WithStdout(io.Discard))
	if err != nil {
		t.Fatal(err)
	}
	srv, err := api.New(ctx, cfg, api.WithProvider("fake", p), api.WithAudit(aud))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	ui.Config.Handler = srv.Handler()

	gcfg := sshgateway.DefaultConfig()
	gcfg.RefreshInterval = 20 * time.Millisecond
	hostKey, err := sshgateway.HostKey(ctx, nil, "", log)
	if err != nil {
		t.Fatal(err)
	}
	g, err := sshgateway.New(gcfg, hostKey, srv, aud, log)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	contract.RegisterSSHGateway(contract.NewAPI(mux, "gateway"), g)
	gatewayAPI.Config.Handler = mux
	go g.Serve(ctx, sshLn)
	return &portal{t: t, url: ui.URL, ui: srv.Handler(), provider: p}
}

func (p *portal) call(method, path, user string, body any) []byte {
	p.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, r)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Remote-User", user)
	rec := httptest.NewRecorder()
	p.ui.ServeHTTP(rec, req)
	if rec.Code >= 300 {
		p.t.Fatalf("%s %s = %d %s", method, path, rec.Code, rec.Body)
	}
	return rec.Body.Bytes()
}

func (p *portal) code(user string) string {
	var c api.ConnectCode
	_ = json.Unmarshal(p.call(http.MethodPost, "/api/v1/connect/codes", user, nil), &c)
	return c.Code
}

func (p *portal) computers(user string) api.ComputerList {
	var list api.ComputerList
	_ = json.Unmarshal(p.call(http.MethodGet, "/api/v1/ssh/computers", user, nil), &list)
	return list
}

func (p *portal) session(owner string) string {
	p.t.Helper()
	s, err := p.provider.Create(context.Background(), contract.CreateSession{ArtifactURL: "http://api/x", ArtifactRef: "src/x", Package: "com.x", Owner: owner})
	if err != nil {
		p.t.Fatal(err)
	}
	return s.ID
}

func echoServer(t *testing.T) int {
	t.Helper()
	port, _ := echoOn(t, 0)
	return port
}

// echoOn serves an echo server on port (any when 0), like a dev server
// that can be stopped and started again on the same port.
func echoOn(t *testing.T, port int) (int, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				_, _ = io.Copy(c, c)
				c.Close()
			}()
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port, func() { ln.Close() }
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

// run starts the client; stop cancels it and returns what Run returned.
func run(t *testing.T, opts Options) (stop func() error) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	var err error
	finished := make(chan struct{})
	go func() {
		err = Run(ctx, opts)
		close(finished)
	}()
	stop = func() error {
		cancel()
		<-finished
		return err
	}
	t.Cleanup(func() { _ = stop() })
	return stop
}

func TestConnect(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	p := newPortal(t)
	id := p.session("otter")
	local, stopDev := echoOn(t, 0)
	out := &syncBuffer{}
	opts := Options{Portal: p.url, Code: p.code("otter"), Publish: []int{local}, Version: "test", OnChange: Printer(out), Log: slog.New(slog.DiscardHandler)}
	stop := run(t, opts)

	reachesOn := func(id string) bool {
		conn, err := p.provider.DialDevice(context.Background(), id, local)
		if err != nil {
			return false
		}
		defer conn.Close()
		if _, err := conn.Write([]byte("ping")); err != nil {
			return false
		}
		buf := make([]byte, 4)
		_, err = io.ReadFull(conn, buf)
		return err == nil && string(buf) == "ping"
	}
	reaches := func() bool { return reachesOn(id) }
	eventually(t, "the local port on the device", reaches)
	eventually(t, "the status block", func() bool { return strings.Contains(out.String(), "● connected") })
	if !strings.Contains(out.String(), "|_| |_|") || !strings.Contains(out.String(), "Listening  ") {
		t.Fatalf("no banner in %q", out.String())
	}

	var adbPort int
	eventually(t, "the computer with its ADB port", func() bool {
		list := p.computers("otter")
		if len(list.Computers) != 1 || len(list.Computers[0].ADB) != 1 {
			return false
		}
		adbPort = list.Computers[0].ADB[0].Port
		return list.Computers[0].Version == "test" && list.Computers[0].ADB[0].Session == "fake-"+id
	})
	conn, err := net.Dial("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(adbPort)))
	if err != nil {
		t.Fatal(err)
	}
	if banner, err := adbproto.Connect(conn); err != nil || !strings.HasPrefix(banner, "device::") {
		t.Fatalf("adb banner %q, %v", banner, err)
	}
	conn.Close()
	if list := p.computers("badger"); len(list.Computers) != 0 {
		t.Fatalf("badger sees %+v", list)
	}

	computer := p.computers("otter").Computers[0].ID
	p.call(http.MethodPut, "/api/v1/ssh/computers/"+computer+"/published", "otter", map[string][]int{"ports": {}})
	eventually(t, "the port to be unpublished", func() bool { return !reaches() })

	if err := stop(); err != nil {
		t.Fatalf("run: %v", err)
	}

	again := opts
	again.Code, again.Publish, again.OnChange = "", nil, nil
	cl, err := New(again)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancelAgain := context.WithCancel(context.Background())
	t.Cleanup(cancelAgain)
	go func() { _ = cl.Run(ctx) }()
	eventually(t, "a reconnect with the saved enrollment", func() bool {
		list := p.computers("otter")
		return len(list.Computers) == 1 && len(list.Computers[0].Published) == 0
	})
	p.call(http.MethodPut, "/api/v1/ssh/computers/"+computer+"/published", "otter", map[string][]int{"ports": {local}})
	eventually(t, "the port published from the portal", reaches)
	eventually(t, "the snapshot to show it", func() bool {
		s := cl.Snapshot()
		return s.Connected && len(s.Active) == 1 && s.Active[0] == local && s.Hostname != "" && len(s.ADB) == 1
	})
	testDevice(t, cl)
	testLaunch(t, cl, p)
	if err := cl.TogglePublished(local); err != nil {
		t.Fatal(err)
	}
	eventually(t, "the port unpublished from the client", func() bool { return !reaches() })
	eventually(t, "the portal to see it", func() bool {
		list := p.computers("otter")
		return len(list.Computers) == 1 && len(list.Computers[0].Published) == 0
	})
	if err := cl.TogglePublished(local); err != nil {
		t.Fatal(err)
	}
	eventually(t, "the port published again from the client", reaches)

	stopDev()
	eventually(t, "the dev server to be down", func() bool { return !reaches() })
	_, stopDev = echoOn(t, local)
	eventually(t, "the restarted dev server, without publishing again", reaches)
	if s := cl.Snapshot(); !slices.Equal(s.Published, []int{local}) || !slices.Equal(s.Active, []int{local}) {
		t.Fatalf("published %v, active %v after the restart", s.Published, s.Active)
	}
	newer := p.session("otter")
	eventually(t, "the port on a device started later", func() bool { return reachesOn(newer) })
	stopDev()

	root, _ := Dir()
	portals, err := Portals(root)
	if err != nil || len(portals) != 1 || portals[0] != p.url {
		t.Fatalf("portals %q, %v", portals, err)
	}
	s, _ := storeFor(root, p.url)
	st, _ := s.load()
	if len(st.Published) != 1 || st.Published[0] != local {
		t.Fatalf("saved %+v", st)
	}
	if u, _ := url.Parse(p.url); !strings.Contains(s.dir, u.Hostname()) {
		t.Fatalf("store dir %s", s.dir)
	}
}

func TestBadCode(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	p := newPortal(t)
	err := Run(context.Background(), Options{Portal: p.url, Code: "nope", Log: slog.New(slog.DiscardHandler)})
	if err == nil || !strings.Contains(err.Error(), "invalid or expired") {
		t.Fatalf("err = %v", err)
	}
	err = Run(context.Background(), Options{Portal: p.url, Log: slog.New(slog.DiscardHandler)})
	if err == nil || !strings.Contains(err.Error(), "not enrolled") {
		t.Fatalf("err = %v", err)
	}
}

func testDevice(t *testing.T, cl *Client) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	sess := cl.Snapshot().Sessions[0]
	if sess.Package == "" {
		t.Fatalf("session without a package: %+v", sess)
	}
	info, err := cl.DeviceInfo(ctx, sess.Slug)
	if err != nil || len(info) == 0 || info[0].Name != "Model" || !strings.Contains(info[0].Value, "Fake Pixel 9") {
		t.Fatalf("device info %+v, %v", info, err)
	}
	app, err := cl.AppInfo(ctx, sess)
	if err != nil || !slices.ContainsFunc(app, func(f Field) bool { return f.Name == "Version" && strings.HasPrefix(f.Value, "4.2.1") }) {
		t.Fatalf("app info %+v, %v", app, err)
	}

	lines := make(chan string, 10)
	lctx, stop := context.WithCancel(ctx)
	go func() {
		_ = cl.Logcat(lctx, sess, false, func(l string) {
			select {
			case lines <- l:
			default:
			}
		})
	}()
	select {
	case <-lines:
	case <-ctx.Done():
		t.Fatal("no logcat line")
	}
	stop()

	sh, err := cl.Shell(sess.Slug)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(sh, "echo shell-works\nexit\n"); err != nil {
		t.Fatal(err)
	}
	out, _ := io.ReadAll(sh)
	if !strings.Contains(string(out), "shell-works") {
		t.Fatalf("shell printed %q", out)
	}
	if u := cl.SessionURL(sess); !strings.HasSuffix(u, "/session/"+sess.Provider+"/"+sess.ID) {
		t.Fatalf("session url %s", u)
	}
}

func testLaunch(t *testing.T, cl *Client, p *portal) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	arts, err := cl.Artifacts(ctx)
	if err != nil || len(arts) != 1 || arts[0].FileName != "helloworld.apk" {
		t.Fatalf("artifacts %+v, %v", arts, err)
	}
	slug, err := cl.Launch(ctx, arts[0])
	if err != nil || !strings.HasPrefix(slug, "fake-") {
		t.Fatalf("launch %q, %v", slug, err)
	}
	var launched control.Session
	eventually(t, "the launched device to join", func() bool {
		for _, s := range cl.Snapshot().Sessions {
			if s.Slug == slug {
				launched = s
				return true
			}
		}
		return false
	})
	if launched.Package != "com.example.helloworld" {
		t.Fatalf("launched %+v", launched)
	}
	if err := cl.AppAction(ctx, launched, "restart"); err != nil {
		t.Fatalf("restart: %v", err)
	}
	if err := cl.Stop(ctx, launched); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if _, err := p.provider.Get(ctx, launched.ID); err == nil {
		eventually(t, "the device to stop", func() bool {
			s, err := p.provider.Get(ctx, launched.ID)
			return err != nil || s.State == contract.StateStopping
		})
	}
}
