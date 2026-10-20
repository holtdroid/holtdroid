package fake

import (
	"archive/tar"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/klauspost/compress/zstd"

	"github.com/holtdroid/holtdroid/internal/contract"
)

const fakeCacheSize = 512 << 10

// appFiles is what a fake app keeps on its device: a file per session it
// ran in, carried over by restores, and a cache.
func (d *device) appFiles(withCache bool) map[string][]byte {
	d.mu.Lock()
	defer d.mu.Unlock()
	root := "data/data/" + d.s.Package + "/"
	files := map[string][]byte{}
	for name, b := range d.files {
		if !strings.Contains(name, "/cache/") {
			files[name] = b
		}
	}
	files[root+"files/session-"+d.s.ID+".txt"] = fmt.Appendf(nil, "%s ran %s\n", d.s.ID, d.s.ArtifactRef)
	files[root+"shared_prefs/holtdroid.xml"] = fmt.Appendf(nil, "<map><string name=\"session\">%s</string></map>\n", d.s.ID)
	if withCache {
		files[root+"cache/blob.bin"] = bytes.Repeat([]byte("cache"), fakeCacheSize/5)
	}
	return files
}

func (d *device) ExportAppData(_ context.Context, req contract.AppDataExport) (contract.AppDataInfo, io.ReadCloser, error) {
	if d.session().State != contract.StateReady {
		return contract.AppDataInfo{}, nil, fmt.Errorf("%w: the device is busy or not ready", contract.ErrInvalid)
	}
	withCache := req.Cache && (req.MaxCacheSize <= 0 || req.MaxCacheSize >= fakeCacheSize)
	files := d.appFiles(false)
	var size int64
	for _, b := range files {
		size += int64(len(b))
	}
	if req.MaxSize > 0 && size > req.MaxSize {
		return contract.AppDataInfo{}, nil, fmt.Errorf("%w: the app has %d bytes of data, the limit is %d", contract.ErrTooLarge, size, req.MaxSize)
	}
	if withCache && req.MaxSize > 0 && size+fakeCacheSize > req.MaxSize {
		withCache = false
	}
	if withCache {
		files = d.appFiles(true)
		size += fakeCacheSize
	}

	var buf bytes.Buffer
	zw, err := zstd.NewWriter(&buf)
	if err != nil {
		return contract.AppDataInfo{}, nil, err
	}
	tw := tar.NewWriter(zw)
	for _, name := range slices.Sorted(maps.Keys(files)) {
		hdr := &tar.Header{Name: name, Mode: 0o600, Size: int64(len(files[name])), ModTime: time.Now(), Uid: 10123, Gid: 10123}
		if err := tw.WriteHeader(hdr); err != nil {
			return contract.AppDataInfo{}, nil, err
		}
		_, _ = tw.Write(files[name])
	}
	if err := errors.Join(tw.Close(), zw.Close()); err != nil {
		return contract.AppDataInfo{}, nil, err
	}
	d.update(func() { d.appClosed = !req.Restart })
	return contract.AppDataInfo{Size: size, Cache: withCache}, io.NopCloser(&buf), nil
}

// restore downloads the archive and keeps its files as the app's data.
func (d *device) restore(ctx context.Context, req contract.AppDataRestore) error {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, req.URL, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download app data: %s", resp.Status)
	}
	zr, err := zstd.NewReader(resp.Body)
	if err != nil {
		return err
	}
	defer zr.Close()
	files := map[string][]byte{}
	tr := tar.NewReader(zr)
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read app data: %w", err)
		}
		if !req.Cache && strings.Contains(h.Name, "/cache/") {
			continue
		}
		b, err := io.ReadAll(tr)
		if err != nil {
			return err
		}
		files[h.Name] = b
	}
	d.update(func() {
		d.files = files
		d.restored = len(files)
	})
	return nil
}

// Restored is the number of files the session's app data restore put back.
func (p *Provider) Restored(id string) (int, error) {
	d, err := p.device(id)
	if err != nil {
		return 0, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.restored, nil
}
