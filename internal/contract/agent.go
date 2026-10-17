package contract

import (
	"context"
	"io"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
)

// Agent is the JSON part of the device agent API. Display assets and the
// DevTools WebSocket/frontend proxy are plain HTTP routes next to it.
type Agent interface {
	Status(ctx context.Context) StatusEvent
	WatchStatus(ctx context.Context, send func(StatusEvent) error) error
	Targets(ctx context.Context) ([]DevToolsTarget, error)
	Clipboard(ctx context.Context) (string, error)
	SetClipboard(ctx context.Context, text string) error
	WatchClipboard(ctx context.Context, send func(Clipboard) error) error
	WatchVibrations(ctx context.Context, send func(Vibration) error) error
	Network(ctx context.Context) (Network, error)
	SetLocation(ctx context.Context, location string) (Network, error)
	App(ctx context.Context, action AppAction) error
	Install(ctx context.Context, req Install) error
	ExportAppData(ctx context.Context, req AppDataExport) (AppDataInfo, io.ReadCloser, error)
	Device(ctx context.Context) (DeviceState, error)
	UpdateDevice(ctx context.Context, settings DeviceSettings) (DeviceState, error)
	DeviceAction(ctx context.Context, action DeviceAction) error
	Screenshot(ctx context.Context) ([]byte, error)
	Tunnels(ctx context.Context) (Tunnels, error)
	WatchTunnels(ctx context.Context, probe bool, send func(Tunnels) error) error
	WatchMetrics(ctx context.Context, send func(Metrics) error) error
}

type AppAction string

// AppRestart starts the app, killing it first if it is running.
const (
	AppRestart   AppAction = "restart"
	AppReinstall AppAction = "reinstall"
)

// DisplayUnsupportedCodec is the WebSocket close code of /display/scrcpy
// when the device can't encode the requested codec.
const DisplayUnsupportedCodec = 4001

type clipboardInput struct {
	Body Clipboard
}

type locationInput struct {
	Body SetLocation
}

type appInput struct {
	Action AppAction `path:"action" enum:"restart,reinstall"`
}

type installInput struct {
	Body Install
}

type exportAppDataInput struct {
	Body AppDataExport
}

const (
	HeaderAppDataSize  = "X-App-Data-Size"
	HeaderAppDataCache = "X-App-Data-Cache"
)

type deviceSettingsInput struct {
	Body DeviceSettings
}

type deviceActionInput struct {
	Action DeviceAction `path:"action" enum:"volume-up,volume-down,mute,screen-off,lock,unlock,back,home,recents,notifications,quick-settings,rotate-left,rotate-right"`
}

type screenshotOutput struct {
	ContentType  string `header:"Content-Type"`
	CacheControl string `header:"Cache-Control"`
	Body         []byte
}

func RegisterAgent(api huma.API, a Agent) {
	tags := []string{"agent"}

	huma.Register(api, huma.Operation{OperationID: "agentHealth", Method: http.MethodGet, Path: "/v1/health", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*body[Health], error) {
			if a.Status(ctx).State != StateReady {
				return nil, huma.Error503ServiceUnavailable("device is not ready")
			}
			return &body[Health]{Health{OK: true}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "getStatus", Method: http.MethodGet, Path: "/v1/state", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*body[StatusEvent], error) {
			return &body[StatusEvent]{a.Status(ctx)}, nil
		})

	sse.Register(api, huma.Operation{OperationID: "watchStatus", Method: http.MethodGet, Path: "/v1/status", Tags: tags},
		map[string]any{"state": StatusEvent{}},
		func(ctx context.Context, _ *struct{}, send sse.Sender) {
			_ = a.WatchStatus(ctx, func(ev StatusEvent) error { return send.Data(ev) })
		})

	huma.Register(api, huma.Operation{OperationID: "listTargets", Method: http.MethodGet, Path: "/v1/devtools/targets", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*body[DevToolsTargets], error) {
			items, err := a.Targets(ctx)
			if err != nil {
				return nil, toHuma(err)
			}
			if items == nil {
				items = []DevToolsTarget{}
			}
			return &body[DevToolsTargets]{DevToolsTargets{Items: items}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "getClipboard", Method: http.MethodGet, Path: "/v1/clipboard", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*body[Clipboard], error) {
			text, err := a.Clipboard(ctx)
			if err != nil {
				return nil, toHuma(err)
			}
			return &body[Clipboard]{Clipboard{Text: text}}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "setClipboard", Method: http.MethodPost, Path: "/v1/clipboard", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *clipboardInput) (*struct{}, error) {
		return nil, toHuma(a.SetClipboard(ctx, in.Body.Text))
	})

	sse.Register(api, huma.Operation{OperationID: "watchClipboard", Method: http.MethodGet, Path: "/v1/clipboard/events", Tags: tags},
		map[string]any{"clip": Clipboard{}},
		func(ctx context.Context, _ *struct{}, send sse.Sender) {
			_ = a.WatchClipboard(ctx, func(c Clipboard) error { return send.Data(c) })
		})

	sse.Register(api, huma.Operation{
		OperationID: "watchVibrations", Method: http.MethodGet, Path: "/v1/vibrations", Tags: tags,
		Description: "Vibrations that start after the stream opens, without touch feedback; the device is only polled while someone listens.",
	}, map[string]any{"vibration": Vibration{}},
		func(ctx context.Context, _ *struct{}, send sse.Sender) {
			_ = a.WatchVibrations(ctx, func(v Vibration) error { return send.Data(v) })
		})

	huma.Register(api, huma.Operation{
		OperationID: "getTunnels", Method: http.MethodGet, Path: "/v1/tunnels/current", Tags: tags,
		Description: "SSH tunnels into the device right now.",
	}, func(ctx context.Context, _ *struct{}) (*body[Tunnels], error) {
		t, err := a.Tunnels(ctx)
		if err != nil {
			return nil, toHuma(err)
		}
		return &body[Tunnels]{t}, nil
	})

	sse.Register(api, huma.Operation{
		OperationID: "watchTunnels", Method: http.MethodGet, Path: "/v1/tunnels", Tags: tags,
		Description: "SSH tunnels into the device; the first event is the current set.",
	}, map[string]any{"tunnels": Tunnels{}},
		func(ctx context.Context, in *watchTunnelsInput, send sse.Sender) {
			_ = a.WatchTunnels(ctx, in.Probe, func(t Tunnels) error { return send.Data(t) })
		})

	sse.Register(api, huma.Operation{
		OperationID: "watchMetrics", Method: http.MethodGet, Path: "/v1/metrics", Tags: tags,
		Description: "Load samples every few seconds; the device is only measured while someone listens.",
	}, map[string]any{"metrics": Metrics{}},
		func(ctx context.Context, _ *struct{}, send sse.Sender) {
			_ = a.WatchMetrics(ctx, func(m Metrics) error { return send.Data(m) })
		})

	huma.Register(api, huma.Operation{OperationID: "getNetwork", Method: http.MethodGet, Path: "/v1/network", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*body[Network], error) {
			n, err := a.Network(ctx)
			if err != nil {
				return nil, toHuma(err)
			}
			return &body[Network]{n}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "setLocation", Method: http.MethodPut, Path: "/v1/network/location", Tags: tags},
		func(ctx context.Context, in *locationInput) (*body[Network], error) {
			n, err := a.SetLocation(ctx, in.Body.Location)
			if err != nil {
				return nil, toHuma(err)
			}
			return &body[Network]{n}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "appAction", Method: http.MethodPost, Path: "/v1/app/{action}", Tags: tags, DefaultStatus: http.StatusAccepted,
	}, func(ctx context.Context, in *appInput) (*struct{}, error) {
		return nil, toHuma(a.App(ctx, in.Action))
	})

	huma.Register(api, huma.Operation{
		OperationID: "installApp", Method: http.MethodPost, Path: "/v1/install", Tags: tags, DefaultStatus: http.StatusNoContent,
		Description: "Downloads and installs another build of the app, then starts it. Returns once it runs.",
	}, func(ctx context.Context, in *installInput) (*struct{}, error) {
		return nil, toHuma(a.Install(ctx, in.Body))
	})

	huma.Register(api, huma.Operation{
		OperationID: "exportAppData", Method: http.MethodPost, Path: "/v1/app-data/export", Tags: tags,
		Description: "Stops the app and streams its private data (/data/data and /data/user_de) as a zstd-compressed tar.",
		Responses: map[string]*huma.Response{"200": {
			Description: "the archive",
			Headers: map[string]*huma.Param{
				HeaderAppDataSize:  {Description: "bytes on the device, uncompressed", Schema: &huma.Schema{Type: "integer"}},
				HeaderAppDataCache: {Description: "the archive includes the cache", Schema: &huma.Schema{Type: "boolean"}},
			},
			Content: map[string]*huma.MediaType{"application/zstd": {Schema: &huma.Schema{Type: "string", Format: "binary"}}},
		}},
	}, func(ctx context.Context, in *exportAppDataInput) (*huma.StreamResponse, error) {
		info, rc, err := a.ExportAppData(ctx, in.Body)
		if err != nil {
			return nil, toHuma(err)
		}
		return &huma.StreamResponse{Body: func(hc huma.Context) {
			defer rc.Close()
			hc.SetHeader("Content-Type", "application/zstd")
			hc.SetHeader(HeaderAppDataSize, strconv.FormatInt(info.Size, 10))
			hc.SetHeader(HeaderAppDataCache, strconv.FormatBool(info.Cache))
			_, _ = io.Copy(hc.BodyWriter(), rc)
		}}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "getDevice", Method: http.MethodGet, Path: "/v1/device", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*body[DeviceState], error) {
			s, err := a.Device(ctx)
			if err != nil {
				return nil, toHuma(err)
			}
			return &body[DeviceState]{s}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "updateDevice", Method: http.MethodPatch, Path: "/v1/device", Tags: tags},
		func(ctx context.Context, in *deviceSettingsInput) (*body[DeviceState], error) {
			s, err := a.UpdateDevice(ctx, in.Body)
			if err != nil {
				return nil, toHuma(err)
			}
			return &body[DeviceState]{s}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "deviceAction", Method: http.MethodPost, Path: "/v1/device/actions/{action}", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *deviceActionInput) (*struct{}, error) {
		return nil, toHuma(a.DeviceAction(ctx, in.Action))
	})

	huma.Register(api, huma.Operation{
		OperationID: "screenshot", Method: http.MethodGet, Path: "/v1/device/screenshot", Tags: tags,
		Responses: map[string]*huma.Response{"200": {
			Description: "PNG of the current screen",
			Content:     map[string]*huma.MediaType{"image/png": {Schema: &huma.Schema{Type: "string", Format: "binary"}}},
		}},
	}, func(ctx context.Context, _ *struct{}) (*screenshotOutput, error) {
		png, err := a.Screenshot(ctx)
		if err != nil {
			return nil, toHuma(err)
		}
		return &screenshotOutput{ContentType: "image/png", CacheControl: "no-store", Body: png}, nil
	})
}

// AgentClient is for providers; browsers reach agents through the api proxy.
type AgentClient struct{ c client }

func NewAgentClient(baseURL string, hc *http.Client) *AgentClient {
	return &AgentClient{newClient(baseURL, hc)}
}

func (a *AgentClient) Tunnels(ctx context.Context) (Tunnels, error) {
	var t Tunnels
	err := a.c.do(ctx, http.MethodGet, "/v1/tunnels/current", nil, &t)
	return t, err
}

func (a *AgentClient) Status(ctx context.Context) (StatusEvent, error) {
	var s StatusEvent
	err := a.c.do(ctx, http.MethodGet, "/v1/state", nil, &s)
	return s, err
}

func (a *AgentClient) Install(ctx context.Context, req Install) error {
	return a.c.withTimeout(installTimeout).do(ctx, http.MethodPost, "/v1/install", req, nil)
}

// ExportAppData streams the app's data; ctx bounds the whole transfer.
func (a *AgentClient) ExportAppData(ctx context.Context, req AppDataExport) (AppDataInfo, io.ReadCloser, error) {
	resp, err := a.c.withTimeout(0).raw(ctx, http.MethodPost, "/v1/app-data/export", req)
	if err != nil {
		return AppDataInfo{}, nil, err
	}
	size, _ := strconv.ParseInt(resp.Header.Get(HeaderAppDataSize), 10, 64)
	cache, _ := strconv.ParseBool(resp.Header.Get(HeaderAppDataCache))
	return AppDataInfo{Size: size, Cache: cache}, resp.Body, nil
}

type watchTunnelsInput struct {
	Probe bool `query:"probe" doc:"while this stream is open, check every few seconds whether a server answers behind each published port"`
}
