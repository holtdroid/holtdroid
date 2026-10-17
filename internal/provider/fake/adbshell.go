package fake

import (
	"context"
	"fmt"
	"io"
	"maps"
	"path"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	fakeAppUID        = 10234
	fakeWebView       = "com.google.android.webview"
	fakeChrome        = "com.android.chrome"
	fakeWebViewV      = "142.0.7444.48"
	fakeChromeV       = "141.0.7390.122"
	bugreportzVersion = "1.2"
)

var fakeProps = map[string]string{
	"ro.product.model":                "Fake Pixel 9",
	"ro.product.manufacturer":         "Google",
	"ro.product.device":               "emu64xa",
	"ro.build.version.release":        "15",
	"ro.build.version.sdk":            "35",
	"ro.build.fingerprint":            "google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys",
	"ro.product.cpu.abi":              "x86_64",
	"ro.product.cpu.abilist":          "x86_64,arm64-v8a",
	"ro.kernel.qemu":                  "1",
	"ro.adb.secure":                   "0",
	"persist.sys.timezone":            "Europe/Vilnius",
	"ro.build.type":                   "userdebug",
	"ro.boot.qemu.avd_name":           "holtdroid",
	"sys.boot_completed":              "1",
	"ro.build.version.security_patch": "2024-08-05",
}

var fakePermissions = []string{
	"android.permission.CAMERA",
	"android.permission.ACCESS_FINE_LOCATION",
	"android.permission.ACCESS_COARSE_LOCATION",
	"android.permission.POST_NOTIFICATIONS",
	"android.permission.RECORD_AUDIO",
	"android.permission.READ_MEDIA_IMAGES",
}

var standbyBuckets = map[string]int{"active": 10, "working_set": 20, "frequent": 30, "rare": 40, "restricted": 45}

// adbState is what the fake device's shell commands change.
type adbState struct {
	denied   map[string]bool
	bucket   int
	settings map[string]string
	idle     bool
	webview  string
}

func (d *device) appPID() int {
	_, _, gen := d.snapshot()
	return 4200 + gen
}

func (d *device) adbState(fn func(*adbState)) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.adb.settings == nil {
		d.adb = adbState{denied: map[string]bool{}, bucket: 10, settings: map[string]string{}, webview: fakeWebView}
	}
	fn(&d.adb)
}

// splitArgs splits a command line the way sh would for simple quoting.
func splitArgs(line string) []string {
	var args []string
	var cur strings.Builder
	inArg := false
	var quote rune
	escaped := false
	for _, r := range line {
		switch {
		case escaped:
			cur.WriteRune(r)
			escaped = false
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '\\':
			escaped, inArg = true, true
		case r == '\'' || r == '"':
			quote, inArg = r, true
		case r == ' ' || r == '\t':
			if inArg {
				args = append(args, cur.String())
				cur.Reset()
				inArg = false
			}
		default:
			cur.WriteRune(r)
			inArg = true
		}
	}
	if inArg {
		args = append(args, cur.String())
	}
	return args
}

// runShell runs a command line on the fake device. It understands `;` and
// `&&` between commands, not pipes or redirections.
func (d *device) runShell(ctx context.Context, line string, stdin io.Reader, stdout, stderr io.Writer) int {
	code := 0
	for stmt := range strings.SplitSeq(line, ";") {
		for i, part := range strings.Split(stmt, "&&") {
			if i > 0 && code != 0 {
				break
			}
			args := splitArgs(part)
			if len(args) == 0 {
				continue
			}
			if strings.ContainsAny(part, "|<>") {
				fmt.Fprintln(stderr, "fake shell: pipes and redirections are not supported")
				code = 1
				continue
			}
			code = d.command(ctx, args, stdin, stdout, stderr)
		}
	}
	return code
}

func (d *device) command(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	s := d.session()
	pkg := s.Package
	fs := d.filesystem()
	now := time.Now()
	fail := func(format string, a ...any) int {
		fmt.Fprintf(stderr, args[0]+": "+format+"\n", a...)
		return 1
	}
	switch args[0] {
	case "true", "clear", "cd", "sync":
		return 0
	case "false":
		return 1
	case "echo":
		fmt.Fprintln(stdout, strings.Join(args[1:], " "))
	case "id":
		fmt.Fprintln(stdout, "uid=0(root) gid=0(root) groups=0(root),1004(input),1007(log),1011(adb),1015(sdcard_rw),3003(inet) context=u:r:su:s0")
	case "whoami":
		fmt.Fprintln(stdout, "root")
	case "pwd":
		fmt.Fprintln(stdout, "/")
	case "uname":
		if slices.Contains(args, "-a") {
			fmt.Fprintln(stdout, "Linux localhost 6.6.30-android15-8-fake #1 SMP PREEMPT x86_64 Toybox")
		} else {
			fmt.Fprintln(stdout, "Linux")
		}
	case "date":
		fmt.Fprintln(stdout, now.Format("Mon Jan  2 15:04:05 MST 2006"))
	case "sleep":
		n, _ := strconv.ParseFloat(arg(args, 1), 64)
		select {
		case <-ctx.Done():
		case <-time.After(time.Duration(n * float64(time.Second))):
		}
	case "getprop":
		if key := arg(args, 1); key != "" {
			fmt.Fprintln(stdout, fakeProps[key])
			return 0
		}
		for _, k := range slices.Sorted(maps.Keys(fakeProps)) {
			fmt.Fprintf(stdout, "[%s]: [%s]\n", k, fakeProps[k])
		}
	case "pidof":
		if arg(args, 1) == pkg && d.appRunning() {
			fmt.Fprintln(stdout, d.appPID())
			return 0
		}
		return 1
	case "ps":
		fmt.Fprintln(stdout, "USER            PID   PPID     VSZ    RSS WCHAN            ADDR S NAME")
		fmt.Fprintln(stdout, "root              1      0 10913676  9264 do_epoll_wait       0 S init")
		fmt.Fprintln(stdout, "system          612    344 15391416 284512 do_epoll_wait      0 S system_server")
		if d.appRunning() {
			fmt.Fprintf(stdout, "u0_a234        %d    344 16271828 198344 do_epoll_wait      0 S %s\n", d.appPID(), pkg)
		}
	case "ls":
		return d.ls(args, stdout, stderr)
	case "cat":
		for _, p := range args[1:] {
			n, ok := fs.stat(p)
			if !ok || n.mode&modeFile == 0 {
				return fail("%s: No such file or directory", p)
			}
			_, _ = stdout.Write(n.data)
		}
	case "touch":
		for _, p := range args[1:] {
			if _, ok := fs.stat(p); !ok {
				if err := fs.write(p, nil, 0o644, now); err != nil {
					return fail("%v", err)
				}
			}
		}
	case "mkdir":
		for _, p := range args[1:] {
			if !strings.HasPrefix(p, "-") {
				if err := fs.mkdirAll(p, now); err != nil {
					return fail("%v", err)
				}
			}
		}
	case "rm":
		recursive := slices.ContainsFunc(args[1:], func(a string) bool { return strings.HasPrefix(a, "-") && strings.Contains(a, "r") })
		force := slices.ContainsFunc(args[1:], func(a string) bool { return strings.HasPrefix(a, "-") && strings.Contains(a, "f") })
		for _, p := range args[1:] {
			if strings.HasPrefix(p, "-") {
				continue
			}
			if err := fs.remove(p, recursive); err != nil && !force {
				return fail("%v", err)
			}
		}
	case "mv":
		if len(args) != 3 {
			return fail("needs a source and a destination")
		}
		if err := fs.rename(args[1], args[2]); err != nil {
			return fail("%v", err)
		}
	case "logcat":
		return d.logcat(ctx, args[1:], stdout)
	case "pm":
		return d.pm(args, stdout, stderr)
	case "am":
		return d.am(args, stdout, stderr)
	case "dumpsys":
		return d.dumpsys(args, stdout, stderr)
	case "cmd":
		switch arg(args, 1) {
		case "settings":
			return d.settingsCmd(args[1:], stdout)
		case "webviewupdate":
			if arg(args, 2) == "set-webview-implementation" {
				p := arg(args, 3)
				if p != fakeWebView && p != fakeChrome {
					fmt.Fprintf(stdout, "Failed to switch to %s, the WebView implementation is now provided by %s.\n", p, fakeWebView)
					return 0
				}
				d.adbState(func(st *adbState) { st.webview = p })
				fmt.Fprintf(stdout, "Success\n")
				return 0
			}
		case "package":
			return d.pm(args[1:], stdout, stderr)
		case "activity":
			return d.am(args[1:], stdout, stderr)
		}
		return fail("Can't find service: %s", arg(args, 1))
	case "settings":
		return d.settingsCmd(args, stdout)
	case "bugreportz":
		switch {
		case slices.Contains(args, "-v"):
			fmt.Fprintln(stderr, bugreportzVersion)
		case slices.Contains(args, "-s"):
			select {
			case <-ctx.Done():
				return 1
			case <-time.After(2 * time.Second):
			}
			_, _ = stdout.Write(fakeBugreport(pkg, now))
		default:
			p := "/bugreports/bugreport-" + now.Format("2006-01-02-15-04-05") + ".zip"
			_ = fs.write(p, fakeBugreport(pkg, now), 0o644, now)
			fmt.Fprintln(stdout, "BEGIN:"+p)
			fmt.Fprintln(stdout, "OK:"+p)
		}
	case "exit":
		n, _ := strconv.Atoi(arg(args, 1))
		return n
	default:
		fmt.Fprintf(stderr, "/system/bin/sh: %s: inaccessible or not found\n", args[0])
		return 127
	}
	return 0
}

func arg(args []string, i int) string {
	if i < len(args) {
		return args[i]
	}
	return ""
}

func (d *device) appRunning() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return !d.appClosed
}

func (d *device) ls(args []string, stdout, stderr io.Writer) int {
	long := false
	var paths []string
	for _, a := range args[1:] {
		if strings.HasPrefix(a, "-") {
			long = long || strings.Contains(a, "l")
			continue
		}
		paths = append(paths, a)
	}
	if len(paths) == 0 {
		paths = []string{"/"}
	}
	fs := d.filesystem()
	for _, p := range paths {
		n, ok := fs.stat(p)
		if !ok {
			fmt.Fprintf(stderr, "ls: %s: No such file or directory\n", p)
			return 1
		}
		entries := []fsEntry{{path.Base(p), n}}
		if n.mode&modeDir != 0 {
			entries, _ = fs.list(p)
		}
		for _, e := range entries {
			if !long {
				fmt.Fprintln(stdout, e.name)
				continue
			}
			kind := "-"
			if e.node.mode&modeDir != 0 {
				kind = "d"
			}
			fmt.Fprintf(stdout, "%srwxrwx--x 2 root root %8d %s %s\n", kind, len(e.node.data), e.node.mtime.Format("2006-01-02 15:04"), e.name)
		}
	}
	return 0
}

func (d *device) pm(args []string, stdout, stderr io.Writer) int {
	pkg := d.session().Package
	switch arg(args, 1) {
	case "list":
		if arg(args, 2) != "packages" {
			break
		}
		third, uid := slices.Contains(args, "-3"), slices.Contains(args, "-U")
		filter := ""
		if last := args[len(args)-1]; !strings.HasPrefix(last, "-") && last != "packages" {
			filter = last
		}
		pkgs := []struct {
			name string
			uid  int
			sys  bool
		}{{pkg, fakeAppUID, false}, {fakeChrome, 10140, true}, {fakeWebView, 10129, true}, {"com.android.settings", 1000, true}, {"com.google.android.apps.nexuslauncher", 10160, true}}
		for _, p := range pkgs {
			if (third && p.sys) || !strings.Contains(p.name, filter) {
				continue
			}
			if uid {
				fmt.Fprintf(stdout, "package:%s uid:%d\n", p.name, p.uid)
			} else {
				fmt.Fprintf(stdout, "package:%s\n", p.name)
			}
		}
		return 0
	case "grant", "revoke":
		if arg(args, 2) != pkg || !slices.Contains(fakePermissions, arg(args, 3)) {
			fmt.Fprintf(stderr, "Exception occurred while executing '%s':\njava.lang.IllegalArgumentException: Unknown permission: %s\n", args[1], arg(args, 3))
			return 255
		}
		d.adbState(func(st *adbState) { st.denied[args[3]] = args[1] == "revoke" })
		return 0
	case "clear":
		d.update(func() { d.appClosed = true })
		fmt.Fprintln(stdout, "Success")
		return 0
	case "path":
		fmt.Fprintf(stdout, "package:/data/app/~~fake==/%s-1/base.apk\n", arg(args, 2))
		return 0
	}
	fmt.Fprintf(stderr, "pm: unknown command %q\n", arg(args, 1))
	return 1
}

func (d *device) am(args []string, stdout, stderr io.Writer) int {
	pkg := d.session().Package
	switch arg(args, 1) {
	case "start", "start-activity":
		action, data := "", ""
		for i := 2; i < len(args); i++ {
			switch args[i] {
			case "-a":
				action = arg(args, i+1)
			case "-d":
				data = arg(args, i+1)
			}
		}
		d.update(func() { d.appClosed = false })
		fmt.Fprintf(stdout, "Starting: Intent { act=%s dat=%s }\n", action, data)
		if slices.Contains(args, "-W") {
			fmt.Fprintf(stdout, "Status: ok\nLaunchState: WARM\nActivity: %s/.MainActivity\nTotalTime: 182\nWaitTime: 190\nComplete\n", pkg)
		}
		return 0
	case "force-stop", "kill":
		if arg(args, 2) == pkg {
			d.update(func() { d.appClosed = true })
		}
		return 0
	case "crash":
		if arg(args, 2) == pkg && d.appRunning() {
			d.crash()
		}
		return 0
	case "get-standby-bucket":
		var b int
		d.adbState(func(st *adbState) { b = st.bucket })
		fmt.Fprintln(stdout, b)
		return 0
	case "set-standby-bucket":
		b, ok := standbyBuckets[arg(args, 3)]
		if !ok {
			b, _ = strconv.Atoi(arg(args, 3))
		}
		d.adbState(func(st *adbState) { st.bucket = b })
		return 0
	case "broadcast":
		fmt.Fprintln(stdout, "Broadcasting: Intent { flg=0x400000 }\nBroadcast completed: result=0")
		return 0
	}
	fmt.Fprintf(stderr, "am: unknown command %q\n", arg(args, 1))
	return 1
}

func (d *device) dumpsys(args []string, stdout, stderr io.Writer) int {
	pkg := d.session().Package
	switch arg(args, 1) {
	case "package":
		var denied map[string]bool
		d.adbState(func(st *adbState) { denied = maps.Clone(st.denied) })
		fmt.Fprintf(stdout, "Packages:\n  Package [%s] (5c2b1f0):\n    appId=%d\n    versionCode=4210 minSdk=24 targetSdk=35\n    versionName=4.2.1\n    firstInstallTime=%s\n    lastUpdateTime=%s\n    install permissions:\n      android.permission.INTERNET: granted=true\n    User 0: ceDataInode=8213 installed=true hidden=false suspended=false stopped=false\n      runtime permissions:\n",
			pkg, fakeAppUID, d.session().CreatedAt.Format("2006-01-02 15:04:05"), d.session().CreatedAt.Format("2006-01-02 15:04:05"))
		for _, p := range fakePermissions {
			fmt.Fprintf(stdout, "        %s: granted=%t, flags=[ USER_SENSITIVE_WHEN_GRANTED|USER_SENSITIVE_WHEN_DENIED]\n", p, !denied[p])
		}
	case "webviewupdate":
		var current string
		d.adbState(func(st *adbState) { current = st.webview })
		version := fakeWebViewV
		if current == fakeChrome {
			version = fakeChromeV
		}
		fmt.Fprintf(stdout, "Current WebView Update Service state\n  Multiprocess enabled: true\n  Current WebView package (name, version): (%s, %s)\n  Minimum targetSdkVersion: 35\n  WebView packages:\n    Valid package %s (versionName: %s, versionCode: 744404833, targetSdkVersion: 35) is  installed/enabled for all users\n    Valid package %s (versionName: %s, versionCode: 739012233, targetSdkVersion: 35) is  installed/enabled for all users\n",
			current, version, fakeWebView, fakeWebViewV, fakeChrome, fakeChromeV)
	case "deviceidle":
		switch arg(args, 2) {
		case "force-idle":
			d.adbState(func(st *adbState) { st.idle = true })
			fmt.Fprintln(stdout, "Now forced in to deep idle mode")
		case "unforce":
			d.adbState(func(st *adbState) { st.idle = false })
			fmt.Fprintln(stdout, "Light state: ACTIVE, deep state: ACTIVE")
		case "get":
			var idle bool
			d.adbState(func(st *adbState) { idle = st.idle })
			fmt.Fprintln(stdout, map[bool]string{true: "IDLE", false: "ACTIVE"}[idle])
		}
	case "battery":
	default:
		fmt.Fprintf(stderr, "Can't find service: %s\n", arg(args, 1))
		return 1
	}
	return 0
}

func (d *device) settingsCmd(args []string, stdout io.Writer) int {
	key := arg(args, 2) + "/" + arg(args, 3)
	d.adbState(func(st *adbState) {
		switch arg(args, 1) {
		case "get":
			if v, ok := st.settings[key]; ok {
				fmt.Fprintln(stdout, v)
			} else {
				fmt.Fprintln(stdout, "null")
			}
		case "put":
			st.settings[key] = arg(args, 4)
		case "delete":
			delete(st.settings, key)
			fmt.Fprintln(stdout, "Deleted 1 rows")
		}
	})
	return 0
}

// interactive is a tiny line-editing shell for the terminal; ^C stops the
// running command or drops the line.
func (d *device) interactive(ctx context.Context, stdin io.Reader, stdout io.Writer) int {
	out := crlf{stdout}
	input := make(chan []byte)
	go func() {
		defer close(input)
		for {
			buf := make([]byte, 1024)
			n, err := stdin.Read(buf)
			if n > 0 {
				select {
				case input <- buf[:n]:
				case <-ctx.Done():
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()
	prompt := func() { _, _ = io.WriteString(stdout, "emu64xa:/ # ") }
	prompt()
	var line []byte
	for {
		var chunk []byte
		select {
		case <-ctx.Done():
			return 0
		case c, ok := <-input:
			if !ok {
				return 0
			}
			chunk = c
		}
		for _, c := range chunk {
			switch c {
			case '\r', '\n':
				_, _ = io.WriteString(stdout, "\r\n")
				cmd := strings.TrimSpace(string(line))
				line = line[:0]
				if cmd == "exit" {
					return 0
				}
				if cmd != "" {
					d.runInteractive(ctx, cmd, input, out)
				}
				prompt()
			case 0x7f, '\b':
				if len(line) > 0 {
					line = line[:len(line)-1]
					_, _ = io.WriteString(stdout, "\b \b")
				}
			case 0x03:
				line = line[:0]
				_, _ = io.WriteString(stdout, "^C\r\n")
				prompt()
			case 0x04:
				if len(line) == 0 {
					return 0
				}
			default:
				if c >= 0x20 {
					line = append(line, c)
					_, _ = stdout.Write([]byte{c})
				}
			}
		}
	}
}

func (d *device) runInteractive(ctx context.Context, cmd string, input <-chan []byte, out io.Writer) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		d.runShell(ctx, cmd, strings.NewReader(""), out, out)
	}()
	for {
		select {
		case <-done:
			return
		case c, ok := <-input:
			if !ok || slices.Contains(c, 0x03) {
				cancel()
				<-done
				if ok {
					_, _ = io.WriteString(out, "^C\n")
				}
				return
			}
		}
	}
}
