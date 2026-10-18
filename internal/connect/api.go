package connect

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/kriakiku/holtdroid/internal/contract/control"
)

// HTTPClient talks to a portal; insecure accepts any TLS certificate.
func HTTPClient(insecure bool) *http.Client {
	t := http.DefaultTransport.(*http.Transport).Clone()
	if insecure {
		t.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // only for portals the user marked as self-signed
	}
	return &http.Client{Transport: t, Timeout: time.Minute}
}

// SavedInsecure says whether this computer accepts portal's certificate
// without checking it, from an earlier --insecure.
func SavedInsecure(portal string) bool {
	root, err := Dir()
	if err != nil {
		return false
	}
	s, err := storeFor(root, portal)
	if err != nil {
		return false
	}
	st, err := s.load()
	return err == nil && st.Insecure
}

// call uses the portal's API as the computer's user, refreshing the access
// token once when it was turned down.
func (cl *Client) call(ctx context.Context, method, path string, in, out any) error {
	for attempt := 0; ; attempt++ {
		var body io.Reader
		if in != nil {
			b, err := json.Marshal(in)
			if err != nil {
				return err
			}
			body = bytes.NewReader(b)
		}
		req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(cl.opts.Portal, "/")+path, body)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+cl.current().AccessToken)
		if in != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		res, err := cl.http.Do(req)
		if err != nil {
			return err
		}
		b, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
		res.Body.Close()
		if err != nil {
			return err
		}
		if res.StatusCode == http.StatusUnauthorized && attempt == 0 {
			if err := cl.refresh(ctx); err != nil {
				return err
			}
			continue
		}
		if res.StatusCode >= 300 {
			var problem struct {
				Detail string `json:"detail"`
			}
			if json.Unmarshal(b, &problem) == nil && problem.Detail != "" {
				return fmt.Errorf("%s", problem.Detail)
			}
			return fmt.Errorf("%s %s: %s", method, path, res.Status)
		}
		if out == nil || len(b) == 0 {
			return nil
		}
		return json.Unmarshal(b, out)
	}
}

// Artifact is a build the user can launch.
type Artifact struct {
	Source     string
	ID         string
	Name       string
	Version    string
	Package    string
	FileName   string
	UploadedAt time.Time
}

// Artifacts lists the newest builds the user can see.
func (cl *Client) Artifacts(ctx context.Context) ([]Artifact, error) {
	var list struct {
		Items []struct {
			Source     string    `json:"source"`
			ID         string    `json:"id"`
			FileName   string    `json:"fileName"`
			UploadedAt time.Time `json:"uploadedAt"`
			Meta       struct {
				Title string `json:"title"`
			} `json:"meta"`
			App *struct {
				Package     string `json:"package"`
				Label       string `json:"label"`
				VersionName string `json:"versionName"`
			} `json:"app"`
		} `json:"items"`
	}
	if err := cl.call(ctx, http.MethodGet, "/api/v1/artifacts?limit=100", nil, &list); err != nil {
		return nil, err
	}
	out := make([]Artifact, 0, len(list.Items))
	for _, it := range list.Items {
		a := Artifact{Source: it.Source, ID: it.ID, FileName: it.FileName, UploadedAt: it.UploadedAt, Name: it.Meta.Title}
		if it.App != nil {
			a.Package, a.Version = it.App.Package, it.App.VersionName
			if a.Name == "" {
				a.Name = it.App.Label
			}
		}
		if a.Name == "" {
			a.Name = it.FileName
		}
		out = append(out, a)
	}
	return out, nil
}

// Launch starts a device with a, on the first provider with a free slot.
func (cl *Client) Launch(ctx context.Context, a Artifact) (string, error) {
	type slot struct {
		State string `json:"state"`
	}
	var providers []struct {
		Name     string `json:"name"`
		Error    string `json:"error"`
		Capacity struct {
			Slots []slot `json:"slots"`
		} `json:"capacity"`
	}
	if err := cl.call(ctx, http.MethodGet, "/api/v1/providers", nil, &providers); err != nil {
		return "", err
	}
	provider := ""
	for _, p := range providers {
		if p.Error != "" {
			continue
		}
		if provider == "" {
			provider = p.Name
		}
		if slices.ContainsFunc(p.Capacity.Slots, func(s slot) bool { return s.State == "free" }) {
			provider = p.Name
			break
		}
	}
	if provider == "" {
		return "", errors.New("no provider can start devices right now")
	}
	var sess struct {
		Provider string `json:"provider"`
		ID       string `json:"id"`
	}
	err := cl.call(ctx, http.MethodPost, "/api/v1/sessions", map[string]string{
		"source": a.Source, "artifactId": a.ID, "provider": provider,
	}, &sess)
	if err != nil {
		return "", err
	}
	return sess.Provider + "-" + sess.ID, nil
}

func sessionPath(s control.Session) string {
	return "/" + url.PathEscape(s.Provider) + "/" + url.PathEscape(s.ID)
}

// Stop ends the session.
func (cl *Client) Stop(ctx context.Context, s control.Session) error {
	return cl.call(ctx, http.MethodDelete, "/api/v1/sessions"+sessionPath(s), nil, nil)
}

// AppAction restarts or reinstalls the session's app through its agent.
func (cl *Client) AppAction(ctx context.Context, s control.Session, action string) error {
	return cl.call(ctx, http.MethodPost, "/s"+sessionPath(s)+"/v1/app/"+url.PathEscape(action), nil, nil)
}
