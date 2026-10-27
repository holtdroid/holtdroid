package contract

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

// AgentMicrophonePath is the agent's WebSocket that takes the browser's
// microphone: binary messages of signed 16-bit little-endian mono PCM at
// MicrophoneRate. While it is open the device's microphone hears it.
const AgentMicrophonePath = "/microphone/browser"

const MicrophoneRate = 48000

type MicrophoneSource string

const (
	MicOff     MicrophoneSource = "off"
	MicTone    MicrophoneSource = "tone"
	MicBeeps   MicrophoneSource = "beeps"
	MicNoise   MicrophoneSource = "noise"
	MicFile    MicrophoneSource = "file"
	MicBrowser MicrophoneSource = "browser"
)

type Microphone struct {
	Available bool             `json:"available" doc:"the device's microphone can be replaced (Android sessions on redroid)"`
	Source    MicrophoneSource `json:"source" enum:"off,tone,beeps,noise,file,browser" doc:"off: the device's own silent microphone; tone: a 1 kHz line-up tone; beeps: a short beep every second; noise: pink noise; file: a media file on repeat; browser: the viewer's microphone"`
	MediaID   string           `json:"mediaId,omitempty" doc:"the media file playing while the source is file"`
	File      string           `json:"file,omitempty" doc:"its name"`
	Error     string           `json:"error,omitempty" doc:"why the last source stopped"`
}

type SetMicrophone struct {
	Source  MicrophoneSource `json:"source" enum:"off,tone,beeps,noise,file"`
	FileURL string           `json:"fileUrl,omitempty" format:"uri" doc:"where the agent downloads the file; only for the file source"`
	MediaID string           `json:"mediaId,omitempty" maxLength:"64"`
	File    string           `json:"file,omitempty" maxLength:"200"`
}

type setMicrophoneInput struct {
	Body SetMicrophone
}

func registerMicrophone(api huma.API, a Agent, tags []string) {
	huma.Register(api, huma.Operation{OperationID: "getMicrophone", Method: http.MethodGet, Path: "/v1/microphone", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*body[Microphone], error) {
			return &body[Microphone]{a.Microphone(ctx)}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "setMicrophone", Method: http.MethodPut, Path: "/v1/microphone", Tags: tags,
		Description: "Replaces what the device's microphone hears. The browser's microphone takes over through " + AgentMicrophonePath + " instead.",
	}, func(ctx context.Context, in *setMicrophoneInput) (*body[Microphone], error) {
		m, err := a.SetMicrophone(ctx, in.Body)
		if err != nil {
			return nil, toHuma(err)
		}
		return &body[Microphone]{m}, nil
	})
}

func (a *AgentClient) Microphone(ctx context.Context) (Microphone, error) {
	var m Microphone
	err := a.c.do(ctx, http.MethodGet, "/v1/microphone", nil, &m)
	return m, err
}

func (a *AgentClient) SetMicrophone(ctx context.Context, in SetMicrophone) (Microphone, error) {
	var m Microphone
	err := a.c.withTimeout(installTimeout).do(ctx, http.MethodPut, "/v1/microphone", in, &m)
	return m, err
}
