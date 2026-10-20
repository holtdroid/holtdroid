package contract

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/holtdroid/holtdroid/internal/telemetry"
)

func TestTraceContextPropagates(t *testing.T) {
	exp := tracetest.NewInMemoryExporter()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exp))
	prevTP, prevProp := otel.GetTracerProvider(), otel.GetTextMapPropagator()
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		otel.SetTracerProvider(prevTP)
		otel.SetTextMapPropagator(prevProp)
	})

	mux := http.NewServeMux()
	registerHealth(NewAPI(mux, "test"), "test")
	srv := httptest.NewServer(telemetry.Handler(mux, "provider"))
	defer srv.Close()

	ctx, span := tp.Tracer("test").Start(context.Background(), "launch")
	var h Health
	if err := newClient(srv.URL, nil).do(ctx, http.MethodGet, "/v1/health", nil, &h); err != nil || !h.OK {
		t.Fatalf("health %+v, %v", h, err)
	}
	span.End()

	var server, client sdktrace.ReadOnlySpan
	for _, s := range exp.GetSpans().Snapshots() {
		switch s.SpanKind() {
		case trace.SpanKindServer:
			server = s
		case trace.SpanKindClient:
			client = s
		}
	}
	if server == nil || client == nil {
		t.Fatalf("spans %v", exp.GetSpans())
	}
	if server.SpanContext().TraceID() != span.SpanContext().TraceID() || server.Parent().SpanID() != client.SpanContext().SpanID() {
		t.Fatalf("server span %v is not a child of the client span %v", server.Parent(), client.SpanContext())
	}
}
