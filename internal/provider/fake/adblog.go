package fake

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"math/rand/v2"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	logMain   = 0
	logSystem = 3
	logCrash  = 4
)

const (
	prioVerbose = 2 + iota
	prioDebug
	prioInfo
	prioWarn
	prioError
	prioFatal
)

type logEntry struct {
	at       time.Time
	pid, tid int
	uid      int
	buffer   int
	prio     byte
	tag, msg string
}

// fakeLog is the fake device's log buffer; a generator appends to it while
// the session is ready.
type fakeLog struct {
	mu      sync.Mutex
	entries []logEntry
	subs    map[chan logEntry]struct{}
}

const logCap = 5000

func (l *fakeLog) add(e logEntry) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = append(l.entries, e)
	if len(l.entries) > logCap {
		l.entries = slices.Delete(l.entries, 0, len(l.entries)-logCap)
	}
	for ch := range l.subs {
		select {
		case ch <- e:
		default:
		}
	}
}

func (l *fakeLog) clear() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = nil
}

func (l *fakeLog) subscribe(tail int) ([]logEntry, chan logEntry, func()) {
	ch := make(chan logEntry, 256)
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.subs == nil {
		l.subs = map[chan logEntry]struct{}{}
	}
	l.subs[ch] = struct{}{}
	start := 0
	if tail >= 0 && tail < len(l.entries) {
		start = len(l.entries) - tail
	}
	return slices.Clone(l.entries[start:]), ch, func() {
		l.mu.Lock()
		delete(l.subs, ch)
		l.mu.Unlock()
	}
}

var appLines = []struct {
	prio     byte
	tag, msg string
}{
	{prioInfo, "chromium", `[INFO:CONSOLE(42)] "Checkout loaded in 412 ms", source: https://example.com/checkout (42)`},
	{prioDebug, "OkHttp", "--> GET https://api.example.com/v2/cart"},
	{prioDebug, "OkHttp", "<-- 200 OK https://api.example.com/v2/cart (87ms, 1.2 kB)"},
	{prioInfo, "CheckoutActivity", "onResume"},
	{prioWarn, "chromium", `[WARNING:CONSOLE(118)] "Deprecated API: document.domain setter", source: https://pay.example.com/widget.js (118)`},
	{prioDebug, "PaymentBridge", "postMessage {type: 'ready', amount: 1999}"},
	{prioError, "chromium", `[ERROR:CONSOLE(7)] "Uncaught TypeError: Cannot read properties of undefined (reading 'token')", source: https://example.com/static/app.js (7)`},
	{prioVerbose, "WebViewClient", "shouldOverrideUrlLoading https://example.com/checkout/confirm"},
	{prioInfo, "Analytics", "event screen_view {screen: checkout}"},
}

var systemLines = []struct {
	prio     byte
	tag, msg string
}{
	{prioInfo, "ActivityManager", "Background started FGS: Allowed [callingPackage: com.google.android.gms]"},
	{prioDebug, "ConnectivityService", "NetworkAgentInfo [WIFI () - 100] validation passed"},
	{prioWarn, "WindowManager", "Unable to start animation, surface is null or no children."},
	{prioInfo, "BatteryStatsService", "In wakeup_callback: resumed from suspend"},
	{prioDebug, "AudioFlinger", "mixer(0x7a3c) throttle end: throttle time(10)"},
}

func (d *device) generateLogs() {
	pidSys := 612
	for i := 0; ; i++ {
		select {
		case <-d.done:
			return
		case <-time.After(time.Duration(400+rand.IntN(900)) * time.Millisecond):
		}
		if d.session().State != "ready" {
			continue
		}
		now := time.Now()
		if rand.IntN(3) > 0 && d.appRunning() {
			l := appLines[rand.IntN(len(appLines))]
			pid := d.appPID()
			d.log.add(logEntry{at: now, pid: pid, tid: pid + rand.IntN(30), uid: fakeAppUID, buffer: logMain, prio: l.prio, tag: l.tag, msg: l.msg})
			continue
		}
		l := systemLines[rand.IntN(len(systemLines))]
		d.log.add(logEntry{at: now, pid: pidSys, tid: pidSys + rand.IntN(200), uid: 1000, buffer: logSystem, prio: l.prio, tag: l.tag, msg: l.msg})
	}
}

// crash logs a Java crash the way AndroidRuntime does and closes the app.
func (d *device) crash() {
	pid := d.appPID()
	now := time.Now()
	lines := []string{
		"FATAL EXCEPTION: main",
		"Process: " + d.session().Package + ", PID: " + strconv.Itoa(pid),
		"java.lang.RuntimeException: Crash requested by am crash",
		"\tat android.app.ActivityThread.handleCrash(ActivityThread.java:2214)",
		"\tat android.os.Handler.dispatchMessage(Handler.java:107)",
		"\tat android.os.Looper.loop(Looper.java:317)",
	}
	for _, msg := range lines {
		d.log.add(logEntry{at: now, pid: pid, tid: pid, uid: fakeAppUID, buffer: logCrash, prio: prioError, tag: "AndroidRuntime", msg: msg})
	}
	d.log.add(logEntry{at: now, pid: 612, tid: 640, uid: 1000, buffer: logSystem, prio: prioInfo, tag: "ActivityManager", msg: fmt.Sprintf("Process %s (pid %d) has died: fg  TOP ", d.session().Package, pid)})
	d.update(func() { d.appClosed = true })
}

func encodeLogEntry(e logEntry) []byte {
	payload := make([]byte, 0, len(e.tag)+len(e.msg)+3)
	payload = append(payload, e.prio)
	payload = append(payload, e.tag...)
	payload = append(payload, 0)
	payload = append(payload, e.msg...)
	payload = append(payload, 0)
	b := make([]byte, 28, 28+len(payload))
	le := binary.LittleEndian
	le.PutUint16(b[0:], uint16(len(payload)))
	le.PutUint16(b[2:], 28)
	le.PutUint32(b[4:], uint32(e.pid))
	le.PutUint32(b[8:], uint32(e.tid))
	le.PutUint32(b[12:], uint32(e.at.Unix()))
	le.PutUint32(b[16:], uint32(e.at.Nanosecond()))
	le.PutUint32(b[20:], uint32(e.buffer))
	le.PutUint32(b[24:], uint32(e.uid))
	return append(b, payload...)
}

var prioLetters = []byte("??VDIWEF")

func formatLogEntry(e logEntry) string {
	return fmt.Sprintf("%s %5d %5d %c %-8s: %s\n", e.at.Format("01-02 15:04:05.000"), e.pid, e.tid, prioLetters[e.prio], e.tag, e.msg)
}

// logcat supports what the portal asks for: -B, -d, -t/-T, -b, -c, -v and
// --pid.
func (d *device) logcat(ctx context.Context, args []string, stdout io.Writer) int {
	binary, dump, tail, pid := false, false, -1, 0
	buffers := map[int]bool{logMain: true, logSystem: true, logCrash: true}
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "-B":
			binary = true
		case a == "-d":
			dump = true
		case a == "-c":
			d.log.clear()
			return 0
		case a == "-g":
			for _, b := range []string{"main", "system", "crash"} {
				fmt.Fprintf(stdout, "%s: ring buffer is 256 KiB (12 KiB consumed, 12 KiB readable), max entry is 5120 B, max payload is 4068 B\n", b)
			}
			return 0
		case a == "-t" || a == "-T":
			tail, _ = strconv.Atoi(arg(args, i+1))
			dump = dump || a == "-t"
			i++
		case a == "-b":
			buffers = map[int]bool{}
			for b := range strings.SplitSeq(arg(args, i+1), ",") {
				switch b {
				case "main":
					buffers[logMain] = true
				case "system":
					buffers[logSystem] = true
				case "crash":
					buffers[logCrash] = true
				case "all", "default":
					buffers = map[int]bool{logMain: true, logSystem: true, logCrash: true}
				}
			}
			i++
		case a == "--pid":
			pid, _ = strconv.Atoi(arg(args, i+1))
			i++
		case strings.HasPrefix(a, "--pid="):
			pid, _ = strconv.Atoi(strings.TrimPrefix(a, "--pid="))
		case a == "-v":
			i++
		}
	}
	write := func(e logEntry) error {
		if !buffers[e.buffer] || (pid != 0 && e.pid != pid) {
			return nil
		}
		var err error
		if binary {
			_, err = stdout.Write(encodeLogEntry(e))
		} else {
			_, err = io.WriteString(stdout, formatLogEntry(e))
		}
		return err
	}
	backlog, ch, cancel := d.log.subscribe(tail)
	defer cancel()
	for _, e := range backlog {
		if write(e) != nil {
			return 1
		}
	}
	if dump {
		return 0
	}
	for {
		select {
		case <-ctx.Done():
			return 0
		case <-d.done:
			return 0
		case e := <-ch:
			if write(e) != nil {
				return 1
			}
		}
	}
}
