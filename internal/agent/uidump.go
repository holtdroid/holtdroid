package agent

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const maxUINodes = 5000

func (a *Agent) UIHierarchy(ctx context.Context) (contract.UIHierarchy, error) {
	return dumpUI(ctx, a.dev)
}

func dumpUI(ctx context.Context, dev shellDevice) (contract.UIHierarchy, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	path := "/data/local/tmp/holtdroid-ui-" + strconv.FormatInt(time.Now().UnixNano(), 36) + ".xml"
	out, err := dev.Shell(ctx, "uiautomator dump "+path+" && cat "+path+"; rm -f "+path)
	start := strings.Index(out, "<hierarchy")
	if start < 0 {
		msg := strings.TrimSpace(out)
		if err != nil {
			msg = err.Error()
		}
		if line, _, _ := strings.Cut(msg, "\n"); line != "" {
			msg = line
		}
		return contract.UIHierarchy{}, fmt.Errorf("%w: uiautomator couldn't read the screen: %s", contract.ErrBusy, msg)
	}
	return parseUIDump(out[start:])
}

var uiBounds = regexp.MustCompile(`^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$`)

func parseUIDump(raw string) (contract.UIHierarchy, error) {
	h := contract.UIHierarchy{Nodes: []contract.UINode{}}
	dec := xml.NewDecoder(strings.NewReader(raw))
	var stack []int
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			if len(h.Nodes) > 0 {
				break
			}
			return h, fmt.Errorf("%w: unreadable uiautomator dump: %w", contract.ErrBusy, err)
		}
		switch t := tok.(type) {
		case xml.StartElement:
			attr := map[string]string{}
			for _, a := range t.Attr {
				attr[a.Name.Local] = a.Value
			}
			if t.Name.Local == "hierarchy" {
				h.Rotation, _ = strconv.Atoi(attr["rotation"])
				continue
			}
			if t.Name.Local != "node" {
				continue
			}
			parent := -1
			if len(stack) > 0 {
				parent = stack[len(stack)-1]
			}
			idx := -1
			if m := uiBounds.FindStringSubmatch(attr["bounds"]); m != nil && len(h.Nodes) < maxUINodes {
				x0, _ := strconv.Atoi(m[1])
				y0, _ := strconv.Atoi(m[2])
				x1, _ := strconv.Atoi(m[3])
				y1, _ := strconv.Atoi(m[4])
				idx = len(h.Nodes)
				h.Nodes = append(h.Nodes, contract.UINode{
					Parent:      parent,
					Class:       attr["class"],
					ResourceID:  attr["resource-id"],
					Text:        clip(attr["text"], 120),
					Description: clip(attr["content-desc"], 120),
					Package:     attr["package"],
					Clickable:   attr["clickable"] == "true",
					X:           x0, Y: y0, W: max(0, x1-x0), H: max(0, y1-y0),
				})
			}
			if idx < 0 {
				idx = parent
			}
			stack = append(stack, idx)
		case xml.EndElement:
			if t.Name.Local == "node" && len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		}
	}
	if len(h.Nodes) == 0 {
		return h, fmt.Errorf("%w: uiautomator found no views on the screen", contract.ErrBusy)
	}
	return h, nil
}

func clip(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}
