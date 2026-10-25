package api

import (
	"bufio"
	"io"
	"regexp"
	"strings"
)

var timedThreadtime = regexp.MustCompile(`^(\d+:\d\d:\d\d\.\d{3})  (\S+ \S+)\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s+(.*?)\s*: (.*)$`)

var levelStyle = map[string]string{"V": "90", "D": "94", "I": "32", "W": "33", "E": "31", "F": "1;35", "A": "1;35"}

func sgr(code, s string) string { return "\x1b[" + code + "m" + s + "\x1b[0m" }

// colorLogLine turns a logcat line of a recording (the time since it
// started, then a threadtime line) into one with ANSI colours by level:
// the level letter bold, the tag in its colour, warnings and worse in
// colour all through. A line that isn't one stays plain and dim.
func colorLogLine(line string) string {
	m := timedThreadtime.FindStringSubmatch(line)
	if m == nil {
		return sgr("90", line)
	}
	level := m[5]
	style := levelStyle[level]
	loud := level == "W" || level == "E" || level == "F" || level == "A"
	msg := m[7]
	if loud {
		msg = sgr(style, msg)
	}
	tag := sgr(style, m[6])
	if !loud {
		tag = sgr("36", m[6])
	}
	var b strings.Builder
	b.WriteString(sgr("90", m[1]))
	b.WriteString("  ")
	b.WriteString(sgr("2", m[2]))
	b.WriteString(" ")
	b.WriteString(sgr("2", m[3]+" "+m[4]))
	b.WriteString(" ")
	b.WriteString(sgr("1;"+style, level))
	b.WriteString(" ")
	b.WriteString(tag)
	b.WriteString(": ")
	b.WriteString(msg)
	return b.String()
}

// copyColored copies logcat lines to w, coloured.
func copyColored(w io.Writer, r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		_, _ = io.WriteString(w, colorLogLine(sc.Text())+"\n")
	}
}
