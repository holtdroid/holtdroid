package telemetry

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
)

func TestInstrumentAndMetrics(t *testing.T) {
	mux := http.NewServeMux()
	api := humago.New(mux, huma.DefaultConfig("test", "v1"))
	Instrument(api, "test-api")
	huma.Register(api, huma.Operation{OperationID: "teapot", Method: http.MethodGet, Path: "/tea"},
		func(context.Context, *struct{}) (*struct{}, error) {
			return nil, huma.NewError(http.StatusTeapot, "no")
		})
	for range 2 {
		Handler(mux, "test").ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/tea", nil))
	}

	rec := httptest.NewRecorder()
	MetricsHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body, _ := io.ReadAll(rec.Body)
	if want := `holtdroid_http_requests_total{api="test-api",code="418",operation="teapot"} 2`; !strings.Contains(string(body), want) {
		t.Fatalf("metrics lack %s:\n%s", want, body)
	}
}

func TestSetup(t *testing.T) {
	shutdown, err := Setup(context.Background(), DefaultConfig(), "api", "test")
	if err != nil {
		t.Fatal(err)
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	bad := DefaultConfig()
	bad.Tracing.SampleRatio = 2
	if _, err := Setup(context.Background(), bad, "api", "test"); err == nil {
		t.Fatal("sampleRatio 2 accepted")
	}
}
