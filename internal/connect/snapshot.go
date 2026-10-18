package connect

import (
	"fmt"
	"io"
	"maps"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/kriakiku/holtdroid/internal/contract/control"
)

// Snapshot is everything the client knows, for a UI to show.
type Snapshot struct {
	Portal               string
	Version              string
	User                 string
	Computer             string
	Hostname             string
	Status               string
	Connected            bool
	Banner               string
	CertificateExpiresAt time.Time
	RefreshExpiresAt     time.Time
	Fingerprint          string
	Dir                  string
	Sessions             []control.Session
	ADB                  []ADBDevice
	Listening            []control.LocalPort
	// Published is what the computer wants published, Active what the
	// gateway accepted on the current connection, Refused why it didn't.
	Published []int
	Active    []int
	Refused   map[int]string
	// ADBOff and PublishOff say the portal turned these off; both are false
	// until the gateway has said.
	ADBOff     bool
	PublishOff bool
}

type ADBDevice struct {
	Session   string
	Port      int
	Connected bool
}

func (cl *Client) Snapshot() Snapshot {
	adb := cl.adbDevices()
	cl.mu.Lock()
	defer cl.mu.Unlock()
	return Snapshot{
		Portal: cl.opts.Portal, Version: cl.opts.Version, User: cl.creds.User, Computer: cl.creds.Computer, Hostname: cl.hostname,
		Status: cl.status, Connected: cl.connected, Banner: cl.banner,
		CertificateExpiresAt: cl.creds.CertificateExpiresAt, RefreshExpiresAt: cl.st.ExpiresAt,
		Fingerprint: fingerprint(cl.signer.PublicKey()), Dir: cl.store.dir,
		Sessions: slices.Clone(cl.sessions), ADB: adb, Listening: slices.Clone(cl.listening),
		Published: slices.Clone(cl.st.Published), Active: slices.Clone(cl.active), Refused: maps.Clone(cl.refused),
		ADBOff: cl.gateway != nil && !cl.gateway.ADB, PublishOff: cl.gateway != nil && !cl.gateway.Publish,
	}
}

func fingerprint(key ssh.PublicKey) string { return ssh.FingerprintSHA256(key) }

func (cl *Client) changed() {
	if cl.opts.OnChange != nil {
		cl.opts.OnChange(cl.Snapshot())
	}
}

// Printer writes the banner once and a short status block whenever the
// connection, the devices or the published ports change; new listeners on
// the computer alone don't print anything. It is the output without a TUI.
func Printer(w io.Writer) func(Snapshot) {
	var (
		mu     sync.Mutex
		banner bool
		last   string
	)
	return func(s Snapshot) {
		mu.Lock()
		defer mu.Unlock()
		if s.Banner != "" && !banner {
			banner = true
			_, _ = io.WriteString(w, s.Banner)
		}
		if s.User == "" {
			return
		}
		block := statusBlock(s)
		key, _, _ := strings.Cut(block, "  Listening")
		if key == last {
			return
		}
		last = key
		_, _ = io.WriteString(w, block)
	}
}

func statusBlock(s Snapshot) string {
	var b strings.Builder
	state := "● connected"
	if !s.Connected {
		state = "○ " + s.Status
	}
	fmt.Fprintf(&b, "\n%s · %s · %s\n", state, s.Portal, s.User)
	if len(s.Sessions) == 0 {
		b.WriteString("  Devices    none running\n")
	}
	adb := map[string]int{}
	for _, a := range s.ADB {
		adb[a.Session] = a.Port
	}
	for i, d := range s.Sessions {
		label := "           "
		if i == 0 {
			label = "  Devices  "
		}
		line := fmt.Sprintf("%s  %-24s", label, d.Slug)
		if p, ok := adb[d.Slug]; ok && !s.ADBOff {
			line += fmt.Sprintf("  adb 127.0.0.1:%d", p)
		}
		b.WriteString(strings.TrimRight(line, " ") + "\n")
	}
	if s.ADBOff {
		b.WriteString("  ADB        turned off on this portal\n")
	}
	if s.PublishOff {
		b.WriteString("  Published  turned off on this portal\n")
	} else {
		fmt.Fprintf(&b, "  Published  %s\n", joinPorts(s.Active))
	}
	fmt.Fprintf(&b, "  Listening  %d ports on this computer\n", len(s.Listening))
	return b.String()
}

func joinPorts(ports []int) string {
	if len(ports) == 0 {
		return "nothing"
	}
	s := make([]string, len(ports))
	for i, p := range ports {
		s[i] = strconv.Itoa(p)
	}
	return strings.Join(s, ", ")
}
