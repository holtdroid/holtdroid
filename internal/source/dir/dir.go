// Package dir is an artifact source backed by a plain directory of APK files.
package dir

import (
	"cmp"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/kriakiku/holtdroid/internal/contract"
)

type Config struct {
	Listen string
	Path   string
}

func DefaultConfig() Config {
	return Config{Listen: ":8080", Path: "/data"}
}

type Source struct {
	path string
}

func New(path string) *Source { return &Source{path: path} }

func (s *Source) scan() ([]contract.Artifact, error) {
	entries, err := os.ReadDir(s.path)
	if err != nil {
		return nil, err
	}
	var out []contract.Artifact
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".apk") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, contract.Artifact{
			ID:         e.Name(),
			FileName:   e.Name(),
			Size:       info.Size(),
			UploadedAt: info.ModTime().UTC(),
		})
	}
	slices.SortFunc(out, func(a, b contract.Artifact) int {
		return cmp.Or(b.UploadedAt.Compare(a.UploadedAt), cmp.Compare(a.ID, b.ID))
	})
	return out, nil
}

func (s *Source) List(_ context.Context, cursor string, limit int) (contract.ArtifactPage, error) {
	all, err := s.scan()
	if err != nil {
		return contract.ArtifactPage{}, err
	}
	offset := 0
	if cursor != "" {
		if offset, err = strconv.Atoi(cursor); err != nil || offset < 0 {
			return contract.ArtifactPage{}, fmt.Errorf("%w: bad cursor", contract.ErrInvalid)
		}
	}
	if limit <= 0 {
		limit = 50
	}
	if offset > len(all) {
		offset = len(all)
	}
	end := min(offset+limit, len(all))
	page := contract.ArtifactPage{Items: all[offset:end]}
	if end < len(all) {
		page.NextCursor = strconv.Itoa(end)
	}
	return page, nil
}

func (s *Source) Get(_ context.Context, id string) (contract.Artifact, error) {
	all, err := s.scan()
	if err != nil {
		return contract.Artifact{}, err
	}
	i := slices.IndexFunc(all, func(a contract.Artifact) bool { return a.ID == id })
	if i < 0 {
		return contract.Artifact{}, fmt.Errorf("%w: %s", contract.ErrNotFound, id)
	}
	return all[i], nil
}

func (s *Source) Open(ctx context.Context, id string) (io.ReadCloser, int64, error) {
	a, err := s.Get(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	f, err := os.Open(filepath.Join(s.path, a.FileName))
	if err != nil {
		return nil, 0, err
	}
	return f, a.Size, nil
}
