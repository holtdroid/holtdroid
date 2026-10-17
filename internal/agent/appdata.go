package agent

import (
	"archive/tar"
	"cmp"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"

	"github.com/klauspost/compress/zstd"

	"github.com/kriakiku/holtdroid/internal/contract"
)

// appDataDevice streams a command's output from the device and copies
// files onto it.
type appDataDevice interface {
	ExecOut(ctx context.Context, cmd string, w io.Writer) error
	Push(ctx context.Context, local, remote string) error
}

var packageName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$`)

func appDataRoots(pkg string) []string {
	return []string{"/data/data/" + pkg, "/data/user_de/0/" + pkg}
}

func isCacheDir(name string) bool { return name == "cache" || name == "code_cache" }

type appDataEntry struct {
	path  string
	size  int64
	cache bool
}

const appDataListScript = `am force-stop %[1]s
for r in /data/data/%[1]s /data/user_de/0/%[1]s; do
  [ -d "$r" ] || continue
  for e in $(ls -A "$r"); do
    [ "$e" = lib ] && continue
    echo "$(du -sk "$r/$e" | cut -f1) $r/$e"
  done
done`

func listAppData(ctx context.Context, dev Device, pkg string) ([]appDataEntry, error) {
	out, err := dev.Shell(ctx, fmt.Sprintf(appDataListScript, pkg))
	if err != nil {
		return nil, err
	}
	var entries []appDataEntry
	for line := range strings.SplitSeq(out, "\n") {
		kb, p, ok := strings.Cut(strings.TrimSpace(line), " ")
		if !ok {
			continue
		}
		n, err := strconv.ParseInt(kb, 10, 64)
		if err != nil || !strings.HasPrefix(p, "/data/") {
			continue
		}
		entries = append(entries, appDataEntry{path: p, size: n << 10, cache: isCacheDir(path.Base(p))})
	}
	return entries, nil
}

func planExport(entries []appDataEntry, req contract.AppDataExport) (contract.AppDataInfo, []string, error) {
	var data, cache int64
	for _, e := range entries {
		if e.cache {
			cache += e.size
		} else {
			data += e.size
		}
	}
	if req.MaxSize > 0 && data > req.MaxSize {
		return contract.AppDataInfo{}, nil, fmt.Errorf("%w: the app has %d bytes of data, the limit is %d", contract.ErrTooLarge, data, req.MaxSize)
	}
	withCache := req.Cache && cache > 0 &&
		(req.MaxCacheSize <= 0 || cache <= req.MaxCacheSize) &&
		(req.MaxSize <= 0 || data+cache <= req.MaxSize)
	var paths []string
	for _, e := range entries {
		if !e.cache || withCache {
			paths = append(paths, strings.TrimPrefix(e.path, "/"))
		}
	}
	if len(paths) == 0 {
		return contract.AppDataInfo{}, nil, fmt.Errorf("%w: the app has no data", contract.ErrNotFound)
	}
	info := contract.AppDataInfo{Size: data, Cache: withCache}
	if withCache {
		info.Size += cache
	}
	return info, paths, nil
}

// streamExport tars paths on the device into w as zstd. The tar is read
// back while it streams, so a truncated one fails instead of being stored.
func streamExport(ctx context.Context, dev appDataDevice, paths []string, w io.Writer) error {
	zw, err := zstd.NewWriter(w)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	pr, pw := io.Pipe()
	done := make(chan error, 1)
	go func() {
		err := rewriteTar(pr, zw, func(*tar.Header) bool { return true })
		if err != nil {
			cancel()
		}
		pr.CloseWithError(err)
		done <- err
	}()
	cmd := "cd / && tar -cf - --numeric-owner " + strings.Join(paths, " ") + " 2>/dev/null"
	execErr := dev.ExecOut(ctx, cmd, pw)
	pw.CloseWithError(execErr)
	if err := cmp.Or(<-done, execErr); err != nil {
		_ = zw.Close()
		return err
	}
	return zw.Close()
}

func rewriteTar(r io.Reader, w io.Writer, keep func(*tar.Header) bool) error {
	tr := tar.NewReader(r)
	tw := tar.NewWriter(w)
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read archive: %w", err)
		}
		if !keep(h) {
			continue
		}
		if err := tw.WriteHeader(h); err != nil {
			return err
		}
		if _, err := io.Copy(tw, tr); err != nil {
			return err
		}
	}
	return tw.Close()
}

// appDataFilter keeps the entries that belong in the app's data directories
// and gives them to the app's current uid; the app usually gets another uid
// on another device. Entries that would write outside those directories or
// through a symlink are dropped.
type appDataFilter struct {
	roots    []string
	uid      int
	oldUID   int
	cache    bool
	symlinks map[string]bool
}

func newAppDataFilter(pkg string, uid int, cache bool) *appDataFilter {
	f := &appDataFilter{uid: uid, oldUID: -1, cache: cache, symlinks: map[string]bool{}}
	for _, r := range appDataRoots(pkg) {
		f.roots = append(f.roots, strings.TrimPrefix(r, "/")+"/")
	}
	return f
}

const cacheGIDOffset = 10000

func (f *appDataFilter) keep(h *tar.Header) bool {
	name := strings.TrimSuffix(h.Name, "/")
	if path.IsAbs(name) || name != path.Clean(name) {
		return false
	}
	var rel string
	for _, root := range f.roots {
		if r, ok := strings.CutPrefix(name, root); ok {
			rel = r
		}
	}
	if rel == "" {
		return false
	}
	top, _, _ := strings.Cut(rel, "/")
	if top == "lib" || (!f.cache && isCacheDir(top)) {
		return false
	}
	for p := name; p != "."; p = path.Dir(p) {
		if f.symlinks[p] {
			return false
		}
	}
	switch h.Typeflag {
	case tar.TypeReg, tar.TypeDir:
	case tar.TypeSymlink:
		f.symlinks[name] = true
	default:
		return false
	}
	if f.oldUID < 0 && h.Uid >= 10000 {
		f.oldUID = h.Uid
	}
	if f.oldUID >= 0 {
		if h.Uid == f.oldUID {
			h.Uid = f.uid
		}
		switch h.Gid {
		case f.oldUID:
			h.Gid = f.uid
		case f.oldUID + cacheGIDOffset:
			h.Gid = f.uid + cacheGIDOffset
		}
	}
	h.Uname, h.Gname = "", ""
	return true
}

const appDataPrepareScript = `am force-stop %[1]s
for r in /data/data/%[1]s /data/user_de/0/%[1]s; do
  [ -d "$r" ] || continue
  echo "root $r $(stat -c '%%u %%C' "$r")"
  for e in $(ls -A "$r"); do
    case "$e" in
      lib) ;;
      cache|code_cache) rm -rf "$r/$e"/* "$r/$e"/.[!.]* ;;
      *) rm -rf "$r/$e" ;;
    esac
  done
done`

const restoreFile = "/data/local/tmp/holtdroid-appdata.tar"

// restoreAppData replaces the app's data with the archive at file. The app
// must be installed and not running. The archive is pushed rather than piped
// through adb exec-in: adbd kills the command once its stdin closes, so its
// exit status would be lost.
func restoreAppData(ctx context.Context, dev Device, pkg, file string, cache bool) error {
	push, ok := dev.(appDataDevice)
	if !ok || !packageName.MatchString(pkg) {
		return errors.New("this device can't restore app data")
	}
	out, err := dev.Shell(ctx, fmt.Sprintf(appDataPrepareScript, pkg))
	if err != nil {
		return err
	}
	uid := -1
	contexts := map[string]string{}
	for line := range strings.SplitSeq(out, "\n") {
		f := strings.Fields(line)
		if len(f) != 4 || f[0] != "root" {
			continue
		}
		if n, err := strconv.Atoi(f[2]); err == nil {
			uid = n
		}
		contexts[f[1]] = f[3]
	}
	if uid < 0 {
		return fmt.Errorf("%s has no data directory", pkg)
	}

	local, err := rewriteArchive(file, newAppDataFilter(pkg, uid, cache))
	if err != nil {
		return err
	}
	defer os.Remove(local)
	if err := push.Push(ctx, local, restoreFile); err != nil {
		return err
	}
	res, err := dev.Shell(ctx, fmt.Sprintf(`tar -xf %[1]s -C / --numeric-owner 2>&1; echo "rc=$?"; rm -f %[1]s`, restoreFile))
	if err != nil {
		return err
	}
	res = strings.TrimSpace(res)
	msg, rc, _ := strings.Cut(res, "rc=")
	if strings.TrimSpace(rc) != "0" {
		return fmt.Errorf("tar on the device: %s", strings.TrimSpace(cmp.Or(msg, res)))
	}

	var relabel []string
	for _, root := range appDataRoots(pkg) {
		if c, ok := contexts[root]; ok {
			relabel = append(relabel, fmt.Sprintf("find %s -mindepth 1 -maxdepth 1 ! -name lib -exec chcon -hR '%s' {} +", root, c))
		}
	}
	_, err = dev.Shell(ctx, strings.Join(relabel, "\n"))
	return err
}

// rewriteArchive decompresses file through filter into a temporary tar.
func rewriteArchive(file string, filter *appDataFilter) (string, error) {
	src, err := os.Open(file)
	if err != nil {
		return "", err
	}
	defer src.Close()
	zr, err := zstd.NewReader(src)
	if err != nil {
		return "", err
	}
	defer zr.Close()
	dst, err := os.CreateTemp("", "holtdroid-appdata-*.tar")
	if err != nil {
		return "", err
	}
	if err := cmp.Or(rewriteTar(zr, dst, filter.keep), dst.Close()); err != nil {
		dst.Close()
		os.Remove(dst.Name())
		return "", err
	}
	return dst.Name(), nil
}
