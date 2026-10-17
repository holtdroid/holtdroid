package fake

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"path"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	modeDir  = 0o040000
	modeFile = 0o100000
)

type fsNode struct {
	mode  uint32
	data  []byte
	mtime time.Time
}

// fakeFS is the fake device's file system: what sync and the shell's file
// commands see.
type fakeFS struct {
	mu    sync.Mutex
	nodes map[string]*fsNode
}

func newFakeFS(pkg string, now time.Time) *fakeFS {
	fs := &fakeFS{nodes: map[string]*fsNode{"/": {mode: modeDir | 0o755, mtime: now}}}
	for _, dir := range []string{
		"/sdcard/Download", "/sdcard/DCIM/Camera", "/sdcard/Pictures/Screenshots", "/sdcard/Android/data/" + pkg + "/files",
		"/data/data/" + pkg + "/cache", "/data/data/" + pkg + "/files", "/data/local/tmp", "/system/bin",
	} {
		_ = fs.mkdirAll(dir, now)
	}
	files := map[string]string{
		"/sdcard/Download/test-upload.pdf":                                     "%PDF-1.4\n% fake document\n",
		"/data/data/" + pkg + "/shared_prefs/" + pkg + "_preferences.xml":      "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    <boolean name=\"onboarding_done\" value=\"true\" />\n    <string name=\"api_base\">https://api.example.com</string>\n</map>\n",
		"/data/data/" + pkg + "/databases/app.db":                              "SQLite format 3\x00",
		"/data/data/" + pkg + "/app_webview/Default/Cookies":                   "SQLite format 3\x00",
		"/data/data/" + pkg + "/app_webview/Default/Local Storage/leveldb/LOG": "fake leveldb log\n",
		"/data/data/" + pkg + "/files/session.json":                            "{\"user\":\"otter\",\"token\":\"redacted\"}\n",
	}
	for p, content := range files {
		_ = fs.write(p, []byte(content), 0o644, now)
	}
	return fs
}

func (fs *fakeFS) mkdirAll(p string, now time.Time) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	return fs.mkdirAllLocked(path.Clean(p), now)
}

func (fs *fakeFS) mkdirAllLocked(p string, now time.Time) error {
	if n, ok := fs.nodes[p]; ok {
		if n.mode&modeDir == 0 {
			return fmt.Errorf("%s: Not a directory", p)
		}
		return nil
	}
	if err := fs.mkdirAllLocked(path.Dir(p), now); err != nil {
		return err
	}
	fs.nodes[p] = &fsNode{mode: modeDir | 0o771, mtime: now}
	return nil
}

func (fs *fakeFS) write(p string, data []byte, perm uint32, now time.Time) error {
	p = path.Clean(p)
	fs.mu.Lock()
	defer fs.mu.Unlock()
	if n, ok := fs.nodes[p]; ok && n.mode&modeDir != 0 {
		return fmt.Errorf("%s: Is a directory", p)
	}
	if err := fs.mkdirAllLocked(path.Dir(p), now); err != nil {
		return err
	}
	fs.nodes[p] = &fsNode{mode: modeFile | perm&0o777, data: data, mtime: now}
	return nil
}

func (fs *fakeFS) stat(p string) (fsNode, bool) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	n, ok := fs.nodes[path.Clean(p)]
	if !ok {
		return fsNode{}, false
	}
	return *n, true
}

type fsEntry struct {
	name string
	node fsNode
}

func (fs *fakeFS) list(dir string) ([]fsEntry, error) {
	dir = path.Clean(dir)
	fs.mu.Lock()
	defer fs.mu.Unlock()
	if n, ok := fs.nodes[dir]; !ok || n.mode&modeDir == 0 {
		return nil, fmt.Errorf("%s: No such file or directory", dir)
	}
	var out []fsEntry
	for p, n := range fs.nodes {
		if p != "/" && path.Dir(p) == dir {
			out = append(out, fsEntry{path.Base(p), *n})
		}
	}
	slices.SortFunc(out, func(a, b fsEntry) int { return strings.Compare(a.name, b.name) })
	return out, nil
}

func (fs *fakeFS) remove(p string, recursive bool) error {
	p = path.Clean(p)
	fs.mu.Lock()
	defer fs.mu.Unlock()
	n, ok := fs.nodes[p]
	if !ok {
		return fmt.Errorf("%s: No such file or directory", p)
	}
	if n.mode&modeDir != 0 && !recursive {
		return fmt.Errorf("%s: Is a directory", p)
	}
	for q := range fs.nodes {
		if q == p || strings.HasPrefix(q, p+"/") {
			delete(fs.nodes, q)
		}
	}
	return nil
}

func (fs *fakeFS) rename(from, to string) error {
	from, to = path.Clean(from), path.Clean(to)
	fs.mu.Lock()
	defer fs.mu.Unlock()
	if _, ok := fs.nodes[from]; !ok {
		return fmt.Errorf("%s: No such file or directory", from)
	}
	if n, ok := fs.nodes[to]; ok && n.mode&modeDir != 0 {
		to = path.Join(to, path.Base(from))
	}
	for q, n := range fs.nodes {
		if q == from || strings.HasPrefix(q, from+"/") {
			delete(fs.nodes, q)
			fs.nodes[to+strings.TrimPrefix(q, from)] = n
		}
	}
	return nil
}

func (d *device) filesystem() *fakeFS {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.fs == nil {
		d.fs = newFakeFS(d.s.Package, time.Now())
	}
	return d.fs
}

func syncHeader(id string, n uint32) []byte {
	b := make([]byte, 8)
	copy(b, id)
	binary.LittleEndian.PutUint32(b[4:], n)
	return b
}

func syncFail(w io.Writer, msg string) {
	_, _ = w.Write(append(syncHeader("FAIL", uint32(len(msg))), msg...))
}

// serveSync implements version 1 of the sync protocol (LIST, STAT, RECV,
// SEND), which is all the fake device advertises.
func (d *device) serveSync(s *adbStream) {
	fs := d.filesystem()
	for {
		var h [8]byte
		if _, err := io.ReadFull(s, h[:]); err != nil {
			return
		}
		id := string(h[:4])
		arg := make([]byte, binary.LittleEndian.Uint32(h[4:]))
		if _, err := io.ReadFull(s, arg); err != nil {
			return
		}
		var err error
		switch id {
		case "LIST":
			err = syncList(s, fs, string(arg))
		case "STAT":
			err = syncStat(s, fs, string(arg))
		case "RECV":
			err = syncRecv(s, fs, string(arg))
		case "SEND":
			err = syncSend(s, fs, string(arg))
		default:
			return
		}
		if err != nil {
			return
		}
	}
}

func dirent(id string, n fsNode, name string) []byte {
	b := make([]byte, 20, 20+len(name))
	copy(b, id)
	le := binary.LittleEndian
	le.PutUint32(b[4:], n.mode)
	le.PutUint32(b[8:], uint32(len(n.data)))
	le.PutUint32(b[12:], uint32(n.mtime.Unix()))
	le.PutUint32(b[16:], uint32(len(name)))
	return append(b, name...)
}

func syncList(w io.Writer, fs *fakeFS, dir string) error {
	entries, _ := fs.list(dir)
	var buf bytes.Buffer
	for _, e := range entries {
		buf.Write(dirent("DENT", e.node, e.name))
	}
	buf.Write(dirent("DONE", fsNode{}, ""))
	_, err := w.Write(buf.Bytes())
	return err
}

func syncStat(w io.Writer, fs *fakeFS, p string) error {
	n, _ := fs.stat(p)
	b := dirent("STAT", n, "")[:16]
	_, err := w.Write(b)
	return err
}

func syncRecv(w io.Writer, fs *fakeFS, p string) error {
	n, ok := fs.stat(p)
	if !ok || n.mode&modeFile == 0 {
		syncFail(w, "open failed: No such file or directory")
		return nil
	}
	var buf bytes.Buffer
	for data := n.data; len(data) > 0; {
		chunk := min(len(data), 64<<10)
		buf.Write(syncHeader("DATA", uint32(chunk)))
		buf.Write(data[:chunk])
		data = data[chunk:]
	}
	buf.Write(syncHeader("DONE", 0))
	_, err := w.Write(buf.Bytes())
	return err
}

func syncSend(rw io.ReadWriter, fs *fakeFS, arg string) error {
	p, modeStr, _ := strings.Cut(arg, ",")
	mode, _ := strconv.ParseUint(modeStr, 10, 32)
	var data bytes.Buffer
	for {
		var h [8]byte
		if _, err := io.ReadFull(rw, h[:]); err != nil {
			return err
		}
		n := binary.LittleEndian.Uint32(h[4:])
		switch string(h[:4]) {
		case "DATA":
			if _, err := io.CopyN(&data, rw, int64(n)); err != nil {
				return err
			}
		case "DONE":
			if err := fs.write(p, data.Bytes(), uint32(mode), time.Unix(int64(n), 0)); err != nil {
				syncFail(rw, err.Error())
				return nil
			}
			_, err := rw.Write(syncHeader("OKAY", 0))
			return err
		default:
			return errors.New("sync: unexpected " + string(h[:4]))
		}
	}
}

func fakeBugreport(pkg string, now time.Time) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	name := "bugreport-emu64xa-" + now.Format("2006-01-02-15-04-05")
	files := map[string]string{
		"main_entry.txt": name + ".txt",
		name + ".txt":    "== dumpstate: " + now.Format(time.DateTime) + "\nBuild: fake\nPackage: " + pkg + "\n",
		"version.txt":    "2.0",
	}
	for n, content := range files {
		f, _ := zw.Create(n)
		_, _ = io.WriteString(f, content)
	}
	_ = zw.Close()
	return buf.Bytes()
}
