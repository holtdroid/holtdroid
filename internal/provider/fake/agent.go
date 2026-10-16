package fake

import (
	"context"
	"fmt"
	"html/template"
	"net/http"

	"github.com/kriakiku/holtdroid/internal/contract"
)

// AgentHandler serves a simulated device agent for every fake session under
// /agents/{id}/, implementing the same contract a real agent does.
func (p *Provider) AgentHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/agents/{id}/", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		d, err := p.device(id)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		http.StripPrefix("/agents/"+id, d.handler).ServeHTTP(w, r)
	})
	return mux
}

func (d *device) buildHandler() http.Handler {
	mux := http.NewServeMux()
	contract.RegisterAgent(contract.NewAPI(mux, "fake agent"), d)
	mux.HandleFunc("GET /display/scrcpy", serveScreen)
	mux.HandleFunc("GET /devtools-frontend/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = devtoolsPage.Execute(w, r.URL.Query().Get("wss"))
	})
	return mux
}

func (d *device) Status(context.Context) contract.StatusEvent {
	s := d.session()
	return contract.StatusEvent{State: s.State, Detail: detail(s.State)}
}

func (d *device) WatchStatus(ctx context.Context, send func(contract.StatusEvent) error) error {
	updates, cancel := d.subscribe()
	defer cancel()
	last := contract.SessionState("")
	for {
		if s := d.session(); s.State != last {
			if err := send(contract.StatusEvent{State: s.State, Detail: detail(s.State)}); err != nil {
				return err
			}
			last = s.State
		}
		select {
		case <-ctx.Done():
			return nil
		case <-updates:
		}
	}
}

func (d *device) Targets(context.Context) ([]contract.DevToolsTarget, error) {
	s, _, gen := d.snapshot()
	return fakeTargets(s, gen), nil
}

func (d *device) Clipboard(context.Context) (string, error) {
	_, clip, _ := d.snapshot()
	return clip, nil
}

func (d *device) SetClipboard(_ context.Context, text string) error {
	d.update(func() { d.clip = text })
	return nil
}

func (d *device) WatchClipboard(ctx context.Context, send func(contract.Clipboard) error) error {
	updates, cancel := d.subscribe()
	defer cancel()
	_, last, _ := d.snapshot()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-updates:
			if _, clip, _ := d.snapshot(); clip != last {
				if err := send(contract.Clipboard{Text: clip}); err != nil {
					return err
				}
				last = clip
			}
		}
	}
}

func (d *device) Network(context.Context) (contract.Network, error) {
	return network(d.session().Location), nil
}

func (d *device) SetLocation(_ context.Context, location string) (contract.Network, error) {
	if !d.offers(location) {
		return contract.Network{}, fmt.Errorf("%w: unknown location %q", contract.ErrInvalid, location)
	}
	d.update(func() { d.s.Location = location })
	return network(location), nil
}

func (d *device) App(context.Context, contract.AppAction) error {
	d.update(func() { d.targetGen++ })
	return nil
}

func fakeTargets(s contract.Session, gen int) []contract.DevToolsTarget {
	if s.State != contract.StateReady {
		return []contract.DevToolsTarget{}
	}
	pid := 4200 + gen
	sock := fmt.Sprintf("webview_devtools_remote_%d", pid)
	return []contract.DevToolsTarget{
		{Socket: sock, PID: pid, Process: s.Package, ID: fmt.Sprintf("page-%d", gen), Type: "page", Title: "Checkout", URL: "https://example.com/checkout", FrontendRev: "fake"},
		{Socket: sock, PID: pid, Process: s.Package, ID: fmt.Sprintf("frame-%d", gen), Type: "iframe", Title: "Payment widget", URL: "https://pay.example.com/widget", FrontendRev: "fake"},
		{Socket: "webview_devtools_remote_4300", PID: 4300, Process: s.Package + ":sandbox", ID: "sw-1", Type: "service_worker", Title: "sw.js", URL: "https://example.com/sw.js", FrontendRev: "fake"},
	}
}

func network(location string) contract.Network {
	ips := map[string][2]string{"direct": {"203.0.113.10", "LT"}, "pl": {"198.51.100.7", "PL"}, "de": {"198.51.100.23", "DE"}, "us": {"192.0.2.44", "US"}}
	v := ips[location]
	return contract.Network{Location: location, ExternalIP: v[0], Country: v[1]}
}

func detail(state contract.SessionState) string {
	switch state {
	case contract.StateProvisioning:
		return "Reserving a fake slot"
	case contract.StateBooting:
		return "Pretending to boot Android"
	case contract.StateInstalling:
		return "Installing the APK"
	case contract.StateInstrumenting:
		return "Enabling WebView debugging"
	default:
		return ""
	}
}

var devtoolsPage = template.Must(template.New("devtools").Parse(`<!doctype html>
<html><head><meta charset="utf-8"><title>Fake DevTools</title>
<style>html,body{margin:0;height:100%;background:#202124;color:#e8eaed;font:13px ui-monospace,monospace}
header{padding:8px 12px;border-bottom:1px solid #3c4043}main{padding:12px}</style></head>
<body><header>Elements · Console · Sources · Network</header>
<main><p>Fake DevTools frontend.</p><p>Would connect to: <code>{{.}}</code></p></main></body></html>`))
