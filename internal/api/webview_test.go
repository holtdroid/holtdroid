package api

import (
	"testing"

	"github.com/holtdroid/holtdroid/internal/source"
)

func TestWebViewLimits(t *testing.T) {
	tests := []struct {
		name   string
		tags   map[string]string
		listed bool
		maxSDK int
		abi    string
	}{
		{"targets current Android", map[string]string{"targetSdk": "36", "abis": "x86_64"}, true, 0, "x86_64"},
		{"targets Android 13", map[string]string{"targetSdk": "33", "abis": "arm64-v8a"}, true, 0, "arm64-v8a"},
		{"targets Android 12", map[string]string{"targetSdk": "31", "abis": "x86_64"}, true, 32, "x86_64"},
		{"targets Android 11", map[string]string{"targetSdk": "30", "abis": "x86_64"}, false, 0, ""},
		{"no target known", map[string]string{"abis": "x86,x86_64"}, true, 0, ""},
		{"32-bit only", map[string]string{"abis": "x86"}, true, 34, ""},
		{"no tags", map[string]string{}, true, 0, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.tags["version"] = "150.0.1.2"
			b, ok := webviewOf("id", source.Artifact{Meta: source.Meta{Tags: tt.tags}})
			if ok != tt.listed {
				t.Fatalf("listed %v", ok)
			}
			if b.view.MaxSDK != tt.maxSDK {
				t.Fatalf("maxSdk %d, want %d", b.view.MaxSDK, tt.maxSDK)
			}
			if got := forcedABI(b.view.ABIs); got != tt.abi {
				t.Fatalf("abi %q, want %q", got, tt.abi)
			}
		})
	}
}
