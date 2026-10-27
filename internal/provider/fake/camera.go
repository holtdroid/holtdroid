package fake

import (
	"context"
	"fmt"
	"net/http"

	"github.com/coder/websocket"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func (d *device) Camera(context.Context) contract.Camera {
	d.mu.Lock()
	defer d.mu.Unlock()
	c := d.cam
	c.Available = true
	if c.Source == "" {
		c.Source = contract.CameraBars
	}
	return c
}

// SetCamera remembers the source; a file source must name a file the agent
// could download.
func (d *device) SetCamera(ctx context.Context, in contract.SetCamera) (contract.Camera, error) {
	if in.Source == contract.CameraFile && (in.MediaID == "" || in.FileURL == "") {
		return contract.Camera{}, fmt.Errorf("%w: the file source needs a media id and a file URL", contract.ErrInvalid)
	}
	d.mu.Lock()
	d.cam = contract.Camera{Source: in.Source}
	if in.Source == contract.CameraFile {
		d.cam.MediaID, d.cam.File = in.MediaID, in.File
	}
	d.mu.Unlock()
	return d.Camera(ctx), nil
}

// serveCamera takes the browser's camera and drops the frames.
func (d *device) serveCamera(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer func() { _ = ws.CloseNow() }()
	ws.SetReadLimit(4 << 20)
	d.mu.Lock()
	d.cam = contract.Camera{Source: contract.CameraBrowser}
	d.mu.Unlock()
	defer func() {
		d.mu.Lock()
		if d.cam.Source == contract.CameraBrowser {
			d.cam = contract.Camera{Source: contract.CameraBars}
		}
		d.mu.Unlock()
	}()
	for {
		if _, _, err := ws.Read(r.Context()); err != nil {
			return
		}
	}
}
