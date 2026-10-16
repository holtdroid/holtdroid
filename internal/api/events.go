package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
)

const eventsInterval = 2 * time.Second

func (s *Server) registerEvents(api huma.API) {
	sse.Register(api, huma.Operation{
		OperationID: "streamEvents", Method: http.MethodGet, Path: "/api/v1/events", Tags: []string{"ui"},
		Description: "Pushes the full session list whenever it changes.",
	}, map[string]any{"sessions": SessionsEvent{}}, func(ctx context.Context, _ *struct{}, send sse.Sender) {
		var last []byte
		ticker := time.NewTicker(eventsInterval)
		defer ticker.Stop()
		for {
			items, errs := s.listSessions(ctx)
			ev := SessionsEvent{Items: items, Errors: errs}
			raw, _ := json.Marshal(ev)
			if !bytes.Equal(raw, last) {
				if err := send.Data(ev); err != nil {
					return
				}
				last = raw
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}
