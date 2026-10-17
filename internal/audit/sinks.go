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

// webhookSink POSTs events as JSON arrays in batches, retrying with backoff;
// a batch that still fails is dropped and counted.
type webhookSink struct {
	cfg    WebhookConfig
	url    string
	authz  string
	hc     *http.Client
	events chan Event
	done   chan struct{}
	sleep  func(context.Context, time.Duration) bool
}

const webhookBuffer = 4096

func newWebhookSink(ctx context.Context, cfg WebhookConfig, reg *secrets.Registry) (*webhookSink, error) {
	target, err := reg.Resolve(ctx, cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("audit.webhook.url: %w", err)
	}
	s := &webhookSink{
		cfg:    cfg,
		url:    target,
		hc:     &http.Client{Timeout: cfg.Timeout, Transport: telemetry.Transport(nil)},
		events: make(chan Event, webhookBuffer),
		done:   make(chan struct{}),
		sleep:  sleepCtx,
	}
	if !cfg.Authorization.IsZero() {
		if s.authz, err = reg.Resolve(ctx, cfg.Authorization); err != nil {
			return nil, fmt.Errorf("audit.webhook.authorization: %w", err)
		}
	}
	go s.run(context.WithoutCancel(ctx))
	return s, nil
}

func (s *webhookSink) Write(_ context.Context, ev Event) {
	select {
	case s.events <- ev:
	default:
		dropped.WithLabelValues("webhook").Inc()
	}
}

func (s *webhookSink) Close(ctx context.Context) error {
	close(s.events)
	select {
	case <-s.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *webhookSink) run(ctx context.Context) {
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

func (s *webhookSink) deliver(ctx context.Context, batch []Event) {
	raw, err := json.Marshal(batch)
	if err != nil {
		dropped.WithLabelValues("webhook").Add(float64(len(batch)))
		return
	}
	backoff := time.Second
	for attempt := 0; ; attempt++ {
		err = s.post(ctx, raw)
		if err == nil {
			return
		}
		if attempt >= s.cfg.Retries || !s.sleep(ctx, backoff) {
			break
		}
		backoff = min(backoff*2, 30*time.Second)
	}
	dropped.WithLabelValues("webhook").Add(float64(len(batch)))
	slog.Warn("audit webhook dropped a batch", "events", len(batch), "err", err)
}

func (s *webhookSink) post(ctx context.Context, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if s.authz != "" {
		req.Header.Set("Authorization", s.authz)
	}
	resp, err := s.hc.Do(req)
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
