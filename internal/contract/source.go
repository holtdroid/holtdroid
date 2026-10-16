package contract

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
)

type Source interface {
	List(ctx context.Context, cursor string, limit int) (ArtifactPage, error)
	Get(ctx context.Context, id string) (Artifact, error)
	Open(ctx context.Context, id string) (io.ReadCloser, int64, error)
}

type idInput struct {
	ID string `path:"id" minLength:"1"`
}

type listArtifactsInput struct {
	Cursor string `query:"cursor"`
	Limit  int    `query:"limit" minimum:"1" maximum:"200" default:"50"`
}

type body[T any] struct {
	Body T
}

func RegisterSource(api huma.API, src Source) {
	huma.Register(api, huma.Operation{
		OperationID: "listArtifacts", Method: http.MethodGet, Path: "/v1/artifacts", Tags: []string{"source"},
	}, func(ctx context.Context, in *listArtifactsInput) (*body[ArtifactPage], error) {
		page, err := src.List(ctx, in.Cursor, in.Limit)
		if err != nil {
			return nil, toHuma(err)
		}
		if page.Items == nil {
			page.Items = []Artifact{}
		}
		return &body[ArtifactPage]{page}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "getArtifact", Method: http.MethodGet, Path: "/v1/artifacts/{id}", Tags: []string{"source"},
	}, func(ctx context.Context, in *idInput) (*body[Artifact], error) {
		a, err := src.Get(ctx, in.ID)
		if err != nil {
			return nil, toHuma(err)
		}
		return &body[Artifact]{a}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "downloadArtifact", Method: http.MethodGet, Path: "/v1/artifacts/{id}/download", Tags: []string{"source"},
		Responses: map[string]*huma.Response{"200": {
			Description: "APK file",
			Content:     map[string]*huma.MediaType{"application/vnd.android.package-archive": {}},
		}},
	}, func(ctx context.Context, in *idInput) (*huma.StreamResponse, error) {
		rc, size, err := src.Open(ctx, in.ID)
		if err != nil {
			return nil, toHuma(err)
		}
		return &huma.StreamResponse{Body: func(hctx huma.Context) {
			defer rc.Close()
			hctx.SetHeader("Content-Type", "application/vnd.android.package-archive")
			if size > 0 {
				hctx.SetHeader("Content-Length", strconv.FormatInt(size, 10))
			}
			hctx.SetStatus(http.StatusOK)
			_, _ = io.Copy(hctx.BodyWriter(), rc)
		}}, nil
	})

	registerHealth(api, "source")
}

type SourceClient struct{ c client }

func NewSourceClient(baseURL string, hc *http.Client) *SourceClient {
	return &SourceClient{newClient(baseURL, hc)}
}

func (s *SourceClient) List(ctx context.Context, cursor string, limit int) (ArtifactPage, error) {
	q := url.Values{}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	var page ArtifactPage
	err := s.c.do(ctx, http.MethodGet, "/v1/artifacts?"+q.Encode(), nil, &page)
	return page, err
}

func (s *SourceClient) Get(ctx context.Context, id string) (Artifact, error) {
	var a Artifact
	err := s.c.do(ctx, http.MethodGet, "/v1/artifacts/"+url.PathEscape(id), nil, &a)
	return a, err
}

func (s *SourceClient) Open(ctx context.Context, id string) (io.ReadCloser, int64, error) {
	resp, err := s.c.raw(ctx, http.MethodGet, "/v1/artifacts/"+url.PathEscape(id)+"/download", nil)
	if err != nil {
		return nil, 0, err
	}
	return resp.Body, resp.ContentLength, nil
}

func (s *SourceClient) Health(ctx context.Context) error {
	return s.c.do(ctx, http.MethodGet, "/v1/health", nil, &Health{})
}
