package fake

import (
	"context"
	"fmt"
	"net/http"

	"github.com/coder/websocket"

	"github.com/holtdroid/holtdroid/internal/contract"
)

func (d *device) Microphone(context.Context) contract.Microphone {
	d.mu.Lock()
	defer d.mu.Unlock()
	m := d.mic
	m.Available = true
	if m.Source == "" {
		m.Source = contract.MicOff
	}
	return m
}

// SetMicrophone remembers the source; a file source must name a file the
// agent could download.
func (d *device) SetMicrophone(ctx context.Context, in contract.SetMicrophone) (contract.Microphone, error) {
	if in.Source == contract.MicFile && (in.MediaID == "" || in.FileURL == "") {
		return contract.Microphone{}, fmt.Errorf("%w: the file source needs a media id and a file URL", contract.ErrInvalid)
	}
	d.mu.Lock()
	d.mic = contract.Microphone{Source: in.Source}
	if in.Source == contract.MicFile {
		d.mic.MediaID, d.mic.File = in.MediaID, in.File
	}
	d.mu.Unlock()
	return d.Microphone(ctx), nil
}

// serveMicrophone takes the browser's microphone and drops the samples.
func (d *device) serveMicrophone(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer func() { _ = ws.CloseNow() }()
	d.mu.Lock()
	d.mic = contract.Microphone{Source: contract.MicBrowser}
	d.mu.Unlock()
	defer func() {
		d.mu.Lock()
		if d.mic.Source == contract.MicBrowser {
			d.mic = contract.Microphone{Source: contract.MicOff}
		}
		d.mu.Unlock()
	}()
	for {
		if _, _, err := ws.Read(r.Context()); err != nil {
			return
		}
	}
}
