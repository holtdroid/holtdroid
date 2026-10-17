package audit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	otellog "go.opentelemetry.io/otel/log"
	sdklog "go.opentelemetry.io/otel/sdk/log"

	"github.com/kriakiku/holtdroid/internal/secrets"
	"github.com/kriakiku/holtdroid/internal/telemetry"
)

type otlpSink struct {
	provider *sdklog.LoggerProvider
	logger   otellog.Logger
}

func newOTLPSink(ctx context.Context, cfg OTLPConfig, service, version string) (*otlpSink, error) {
	var opts []otlploghttp.Option
	if cfg.Endpoint != "" {
		opts = append(opts, otlploghttp.WithEndpointURL(cfg.Endpoint))
	}
	if cfg.Insecure {
		opts = append(opts, otlploghttp.WithInsecure())
	}
	exp, err := otlploghttp.New(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("audit.otlp: %w", err)
	}
	p := sdklog.NewLoggerProvider(
		sdklog.WithProcessor(sdklog.NewBatchProcessor(exp)),
		sdklog.WithResource(telemetry.Resource(service, version)),
	)
	return &otlpSink{provider: p, logger: p.Logger("holtdroid/audit")}, nil
}

func (s *otlpSink) Write(ctx context.Context, ev Event) {
	var r otellog.Record
	r.SetTimestamp(ev.Time)
	r.SetSeverity(otellog.SeverityInfo)
	r.SetEventName(string(ev.Action))
	r.SetBody(attribute.StringValue("audit"))
	r.AddAttributes(attribute.String("log", "audit"))
	for _, f := range ev.fields() {
		switch v := f.value.(type) {
		case string:
			r.AddAttributes(attribute.String(f.key, v))
		case int:
			r.AddAttributes(attribute.Int(f.key, v))
		case bool:
			r.AddAttributes(attribute.Bool(f.key, v))
		case map[string]string:
			kvs := make([]attribute.KeyValue, 0, len(v))
			for _, k := range sortedKeys(v) {
				kvs = append(kvs, attribute.String(k, v[k]))
			}
			r.AddAttributes(attribute.Map(f.key, kvs...))
		}
	}
	s.logger.Emit(ctx, r)
}

func (s *otlpSink) Close(ctx context.Context) error { return s.provider.Shutdown(ctx) }

// batchSink hands events to send in batches, retrying with backoff; a
// batch that still fails is dropped and counted.
type batchSink struct {
	name   string
	cfg    WebhookConfig
	send   func(context.Context, []Event) error
	events chan Event
	done   chan struct{}
	sleep  func(context.Context, time.Duration) bool
}

const batchBuffer = 4096

func newBatchSink(ctx context.Context, name string, cfg WebhookConfig, send func(context.Context, []Event) error) *batchSink {
	s := &batchSink{
		name:   name,
		cfg:    cfg,
		send:   send,
		events: make(chan Event, batchBuffer),
		done:   make(chan struct{}),
		sleep:  sleepCtx,
	}
	go s.run(context.WithoutCancel(ctx))
	return s
}

func newWebhookSink(ctx context.Context, cfg WebhookConfig, reg *secrets.Registry) (*batchSink, error) {
	target, err := reg.Resolve(ctx, cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("audit.webhook.url: %w", err)
	}
	var authz string
	if !cfg.Authorization.IsZero() {
		if authz, err = reg.Resolve(ctx, cfg.Authorization); err != nil {
			return nil, fmt.Errorf("audit.webhook.authorization: %w", err)
		}
	}
	hc := &http.Client{Timeout: cfg.Timeout, Transport: telemetry.Transport(nil)}
	return newBatchSink(ctx, "webhook", cfg, func(ctx context.Context, batch []Event) error {
		return post(ctx, hc, target, authz, batch)
	}), nil
}

func (s *batchSink) Write(_ context.Context, ev Event) {
	select {
	case s.events <- ev:
	default:
		dropped.WithLabelValues(s.name).Inc()
	}
}

func (s *batchSink) Close(ctx context.Context) error {
	close(s.events)
	select {
	case <-s.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *batchSink) run(ctx context.Context) {
	defer close(s.done)
	ticker := time.NewTicker(s.cfg.FlushInterval)
	defer ticker.Stop()
	batch := make([]Event, 0, s.cfg.BatchSize)
	flush := func() {
		if len(batch) > 0 {
			s.deliver(ctx, batch)
			batch = batch[:0]
		}
	}
	for {
		select {
		case ev, ok := <-s.events:
			if !ok {
				flush()
				return
			}
			batch = append(batch, ev)
			if len(batch) >= s.cfg.BatchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func (s *batchSink) deliver(ctx context.Context, batch []Event) {
	backoff := time.Second
	var err error
	for attempt := 0; ; attempt++ {
		err = s.send(ctx, batch)
		if err == nil {
			return
		}
		if attempt >= s.cfg.Retries || !s.sleep(ctx, backoff) {
			break
		}
		backoff = min(backoff*2, 30*time.Second)
	}
	dropped.WithLabelValues(s.name).Add(float64(len(batch)))
	slog.Warn("audit sink dropped a batch", "sink", s.name, "events", len(batch), "err", err)
}

func post(ctx context.Context, hc *http.Client, target, authz string, batch []Event) error {
	body, err := json.Marshal(batch)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return redact(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if authz != "" {
		req.Header.Set("Authorization", authz)
	}
	resp, err := hc.Do(req)
	if err != nil {
		return fmt.Errorf("post: %w", redact(err))
	}
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("status %s", resp.Status)
	}
	return nil
}

// redact drops the URL from transport errors: webhook URLs often carry a token.
func redact(err error) error {
	if ue, ok := errors.AsType[*url.Error](err); ok {
		return ue.Err
	}
	return err
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-ctx.Done():
		return false
	}
}
