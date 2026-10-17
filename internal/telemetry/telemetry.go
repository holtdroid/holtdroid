// Package telemetry wires Prometheus metrics and OpenTelemetry tracing into
// every component. Both are off unless configured.
package telemetry

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"
)

type Config struct {
	Metrics MetricsConfig
	Tracing TracingConfig
}

type MetricsConfig struct {
	Listen string
}

type TracingConfig struct {
	Enabled     bool
	Endpoint    string
	Insecure    bool
	SampleRatio float64
}

func DefaultConfig() Config {
	return Config{Tracing: TracingConfig{SampleRatio: 1}}
}

func (c Config) Validate() error {
	if c.Tracing.SampleRatio < 0 || c.Tracing.SampleRatio > 1 {
		return errors.New("telemetry.tracing.sampleRatio must be between 0 and 1")
	}
	return nil
}

func Resource(service, version string) *resource.Resource {
	return resource.NewSchemaless(semconv.ServiceName("holtdroid-"+service), semconv.ServiceVersion(version))
}

// Setup installs the global tracer provider and W3C trace context
// propagation. The returned function flushes pending spans.
func Setup(ctx context.Context, cfg Config, service, version string) (func(context.Context) error, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if !cfg.Tracing.Enabled {
		return func(context.Context) error { return nil }, nil
	}
	var opts []otlptracehttp.Option
	if cfg.Tracing.Endpoint != "" {
		opts = append(opts, otlptracehttp.WithEndpointURL(cfg.Tracing.Endpoint))
	}
	if cfg.Tracing.Insecure {
		opts = append(opts, otlptracehttp.WithInsecure())
	}
	exp, err := otlptracehttp.New(ctx, opts...)
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(Resource(service, version)),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(cfg.Tracing.SampleRatio))),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	return tp.Shutdown, nil
}

// Handler traces incoming requests; without Setup it only passes them on.
func Handler(h http.Handler, service string) http.Handler {
	return otelhttp.NewHandler(h, service)
}

// Transport traces outgoing requests and propagates the trace context.
func Transport(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return otelhttp.NewTransport(base)
}

func MetricsHandler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", promhttp.Handler())
	return mux
}

var (
	httpRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "holtdroid_http_requests_total",
		Help: "API requests by API, operation and status code.",
	}, []string{"api", "operation", "code"})
	httpDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "holtdroid_http_request_duration_seconds",
		Help:    "Time to answer API requests; streaming operations count until the stream ends.",
		Buckets: prometheus.DefBuckets,
	}, []string{"api", "operation"})
)

// Instrument counts the requests of a huma API by operation.
func Instrument(api huma.API, name string) {
	api.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
		start := time.Now()
		next(ctx)
		op := ctx.Operation().OperationID
		code := ctx.Status()
		if code == 0 {
			code = http.StatusOK
		}
		httpRequests.WithLabelValues(name, op, strconv.Itoa(code)).Inc()
		httpDuration.WithLabelValues(name, op).Observe(time.Since(start).Seconds())
	})
}
