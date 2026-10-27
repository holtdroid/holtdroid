package contract

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

// AgentCameraPath is the agent's WebSocket that takes the browser's camera:
// binary messages are JPEG frames. While it is open the device's camera
// shows them.
const AgentCameraPath = "/camera/browser"

type CameraSource string

const (
	CameraBars    CameraSource = "bars"
	CameraBlack   CameraSource = "black"
	CameraFile    CameraSource = "file"
	CameraBrowser CameraSource = "browser"
)

type Camera struct {
	Available bool         `json:"available" doc:"the device has Holtdroid's camera (redroid images with the camera HAL)"`
	Source    CameraSource `json:"source" enum:"bars,black,file,browser" doc:"bars: a test card with a running clock; black: no picture; file: an image or a video from the media library, on repeat; browser: the viewer's camera"`
	MediaID   string       `json:"mediaId,omitempty" doc:"the media file showing while the source is file"`
	File      string       `json:"file,omitempty" doc:"its name"`
	InUse     bool         `json:"inUse" doc:"an app has the camera open now"`
	Error     string       `json:"error,omitempty" doc:"why the last source stopped"`
}

type SetCamera struct {
	Source  CameraSource `json:"source" enum:"bars,black,file"`
	FileURL string       `json:"fileUrl,omitempty" format:"uri" doc:"where the agent downloads the file; only for the file source"`
	MediaID string       `json:"mediaId,omitempty" maxLength:"64"`
	File    string       `json:"file,omitempty" maxLength:"200"`
	Image   bool         `json:"image,omitempty" doc:"the file is a still image"`
}

type setCameraInput struct {
	Body SetCamera
}

func registerCamera(api huma.API, a Agent, tags []string) {
	huma.Register(api, huma.Operation{OperationID: "getCamera", Method: http.MethodGet, Path: "/v1/camera", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*body[Camera], error) {
			return &body[Camera]{a.Camera(ctx)}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "setCamera", Method: http.MethodPut, Path: "/v1/camera", Tags: tags,
		Description: "Replaces what the device's camera shows. The browser's camera takes over through " + AgentCameraPath + " instead.",
	}, func(ctx context.Context, in *setCameraInput) (*body[Camera], error) {
		c, err := a.SetCamera(ctx, in.Body)
		if err != nil {
			return nil, toHuma(err)
		}
		return &body[Camera]{c}, nil
	})
}

func (a *AgentClient) Camera(ctx context.Context) (Camera, error) {
	var c Camera
	err := a.c.do(ctx, http.MethodGet, "/v1/camera", nil, &c)
	return c, err
}

func (a *AgentClient) SetCamera(ctx context.Context, in SetCamera) (Camera, error) {
	var c Camera
	err := a.c.withTimeout(installTimeout).do(ctx, http.MethodPut, "/v1/camera", in, &c)
	return c, err
}
