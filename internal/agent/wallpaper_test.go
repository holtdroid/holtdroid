package agent

import (
	"slices"
	"testing"
)

func TestWallpaper(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Package = "com.example.helloworld"
	cfg.Version = "abc123"
	cfg.Session = Session{ID: "s1", Owner: "alice", Slot: "k3s-1", CreatedAt: "2026-10-17T09:05:03.25+03:00"}

	tests := []struct {
		name string
		file string
		want [][2]string
	}{
		{"apk", "../apk/testdata/helloworld.apk", [][2]string{
			{"session", "s1"},
			{"user", "alice"},
			{"started", "2026-10-17 06:05:03 UTC"},
			{"app", "HelloWorld · com.example.helloworld"},
			{"build", "1.0 (1)"},
			{"artifact", "local/app.apk@1"},
			{"node", "k3s-1"},
			{"holtdroid", "abc123"},
		}},
		{"unreadable apk", "missing.apk", [][2]string{
			{"session", "s1"},
			{"user", "alice"},
			{"started", "2026-10-17 06:05:03 UTC"},
			{"app", "com.example.helloworld"},
			{"artifact", "local/app.apk@1"},
			{"node", "k3s-1"},
			{"holtdroid", "abc123"},
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := (&Agent{cfg: cfg}).wallpaper("local/app.apk@1", tt.file)
			if !slices.Equal(got.Rows, tt.want) {
				t.Fatalf("rows\n%v\nwant\n%v", got.Rows, tt.want)
			}
		})
	}
}
