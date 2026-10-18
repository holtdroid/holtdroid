package tui

import (
	"regexp"
	"strings"

	"github.com/charmbracelet/x/ansi"
)

// Clickable parts of a frame are wrapped in OSC 7777 markers while it is
// drawn: View strips them, and a click draws the frame again to find them.
const zoneOSC = "\x1b]7777;"

var zoneMarker = regexp.MustCompile("\x1b\\]7777;[^\x07]*\x07")

func zone(id, s string) string {
	return zoneOSC + id + "\x07" + s + zoneOSC + "\x07"
}

func stripZones(s string) string {
	return zoneMarker.ReplaceAllString(s, "")
}

// zoneAt is the innermost zone at cell (x, y) of a frame drawn with
// markers. Zones don't span lines.
func zoneAt(frame string, x, y int) string {
	lines := strings.Split(frame, "\n")
	if y < 0 || y >= len(lines) {
		return ""
	}
	line := lines[y]
	var open []string
	col := 0
	var state byte
	for line != "" {
		seq, width, n, next := ansi.DecodeSequence(line, state, nil)
		state = next
		line = line[n:]
		if rest, ok := strings.CutPrefix(seq, zoneOSC); ok {
			if id := strings.TrimSuffix(rest, "\x07"); id != "" {
				open = append(open, id)
			} else if len(open) > 0 {
				open = open[:len(open)-1]
			}
			continue
		}
		if x >= col && x < col+width && len(open) > 0 {
			return open[len(open)-1]
		}
		col += width
	}
	return ""
}
