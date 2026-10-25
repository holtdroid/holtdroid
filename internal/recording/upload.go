package recording

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"
)

var (
	ErrQuota   = errors.New("the recording storage quota is used up")
	errBacklog = errors.New("uploads fell too far behind")
)

type file struct {
	name string
	data []byte
}

// uploader PUTs files in order, the newest manifest replacing a queued one.
type uploader struct {
	base string
	hc   *http.Client
	log  *slog.Logger
	max  int

	mu     sync.Mutex
	cond   *sync.Cond
	queue  []file
	bytes  int
	closed bool
	done   chan struct{}
}

func newUploader(base string, maxBacklog int, log *slog.Logger) *uploader {
	u := &uploader{base: strings.TrimRight(base, "/"), hc: &http.Client{Timeout: 2 * time.Minute}, log: log, max: maxBacklog, done: make(chan struct{})}
	u.cond = sync.NewCond(&u.mu)
	return u
}

func (u *uploader) add(name string, data []byte) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if name == "manifest.json" && len(u.queue) > 1 {
		for i := 1; i < len(u.queue); i++ {
			if u.queue[i].name == name {
				u.bytes -= len(u.queue[i].data)
				u.queue = append(u.queue[:i], u.queue[i+1:]...)
				break
			}
		}
	}
	u.queue = append(u.queue, file{name, data})
	u.bytes += len(data)
	u.cond.Signal()
}

func (u *uploader) close() {
	u.mu.Lock()
	u.closed = true
	u.cond.Signal()
	u.mu.Unlock()
}

func (u *uploader) wait(ctx context.Context) {
	select {
	case <-u.done:
	case <-ctx.Done():
	}
}

func (u *uploader) run(fail func(error)) {
	defer close(u.done)
	for {
		u.mu.Lock()
		for len(u.queue) == 0 && !u.closed {
			u.cond.Wait()
		}
		if len(u.queue) == 0 {
			u.mu.Unlock()
			return
		}
		if u.max > 0 && u.bytes > u.max {
			u.queue, u.bytes = nil, 0
			u.mu.Unlock()
			fail(errBacklog)
			continue
		}
		f := u.queue[0]
		u.mu.Unlock()

		if err := u.send(f); err != nil {
			u.mu.Lock()
			u.queue, u.bytes = nil, 0
			u.mu.Unlock()
			fail(err)
			continue
		}
		u.mu.Lock()
		u.queue = u.queue[1:]
		u.bytes -= len(f.data)
		u.mu.Unlock()
	}
}

type permanent struct{ error }

func (u *uploader) send(f file) error {
	wait := time.Second
	deadline := time.Now().Add(10 * time.Minute)
	for {
		err := u.put(f)
		var p permanent
		switch {
		case err == nil:
			return nil
		case errors.As(err, &p):
			return p.error
		case time.Now().After(deadline):
			return err
		}
		u.log.Warn("recording upload failed, retrying", "file", f.name, "err", err)
		time.Sleep(wait)
		wait = min(wait*2, 30*time.Second)
	}
}

func (u *uploader) put(f file) error {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPut, u.base+"/"+f.name, bytes.NewReader(f.data))
	if err != nil {
		return permanent{err}
	}
	req.ContentLength = int64(len(f.data))
	req.Header.Set("Content-Type", contentType(f.name))
	resp, err := u.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	switch {
	case resp.StatusCode < 300:
		return nil
	case resp.StatusCode == http.StatusInsufficientStorage:
		return permanent{ErrQuota}
	case resp.StatusCode >= 500, resp.StatusCode == http.StatusTooManyRequests, resp.StatusCode == http.StatusRequestTimeout:
		return fmt.Errorf("upload %s: %s", f.name, resp.Status)
	default:
		return permanent{fmt.Errorf("upload %s: %s: %s", f.name, resp.Status, bytes.TrimSpace(msg))}
	}
}

func contentType(name string) string {
	switch path.Ext(name) {
	case ".json":
		return "application/json"
	case ".jpg":
		return "image/jpeg"
	case ".mp4", ".m4s":
		return "video/mp4"
	default:
		return "application/gzip"
	}
}
