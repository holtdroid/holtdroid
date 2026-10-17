package contract

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kriakiku/holtdroid/internal/audit"
)

// SSHGateway is the internal API every ssh-gateway replica serves to the api.
type SSHGateway interface {
	SetUserKeys(ctx context.Context, user string, keys UserKeys) error
	KeyRequest(ctx context.Context, code string) (KeyRequest, error)
}

// KeyRequest is an SSH connection waiting on one replica for its unknown key
// to be added in the portal. The client has proven it holds the private key.
type KeyRequest struct {
	PublicKey   string    `json:"publicKey" doc:"authorized_keys line"`
	Fingerprint string    `json:"fingerprint"`
	Session     string    `json:"session" doc:"SSH user name the client asked for"`
	ClientIP    string    `json:"clientIP"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type keyRequestInput struct {
	Code string `path:"code" pattern:"^[a-z2-7]{16}$"`
}

type UserKeys struct {
	Groups []string `json:"groups"`
	Admin  bool     `json:"admin"`
	Keys   []string `json:"keys" maxItems:"64" doc:"authorized_keys lines; replaces the user's set and restarts its TTL"`
}

// KeysClaimedError lists the indexes of keys another user has registered.
type KeysClaimedError struct {
	Keys []int
}

func (e *KeysClaimedError) Error() string { return "key is registered by another user" }

type setUserKeysInput struct {
	User string `path:"user" minLength:"1"`
	Body UserKeys
}

func keyLocation(i int) string { return fmt.Sprintf("body.keys[%d]", i) }

func RegisterSSHGateway(api huma.API, g SSHGateway) {
	tags := []string{"ssh-gateway"}

	huma.Register(api, huma.Operation{
		OperationID: "setUserKeys", Method: http.MethodPut, Path: "/v1/users/{user}/keys", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *setUserKeysInput) (*struct{}, error) {
		err := g.SetUserKeys(ctx, in.User, in.Body)
		if claimed, ok := errors.AsType[*KeysClaimedError](err); ok {
			details := make([]error, 0, len(claimed.Keys))
			for _, i := range claimed.Keys {
				details = append(details, &huma.ErrorDetail{Message: claimed.Error(), Location: keyLocation(i)})
			}
			return nil, huma.Error409Conflict(claimed.Error(), details...)
		}
		return nil, toHuma(err)
	})

	huma.Register(api, huma.Operation{OperationID: "getKeyRequest", Method: http.MethodGet, Path: "/v1/key-requests/{code}", Tags: tags},
		func(ctx context.Context, in *keyRequestInput) (*body[KeyRequest], error) {
			r, err := g.KeyRequest(ctx, in.Code)
			if err != nil {
				return nil, toHuma(err)
			}
			return &body[KeyRequest]{r}, nil
		})

	registerHealth(api, "ssh-gateway")
}

type SSHGatewayClient struct{ c client }

func NewSSHGatewayClient(baseURL string, hc *http.Client) *SSHGatewayClient {
	return &SSHGatewayClient{newClient(baseURL, hc)}
}

func (g *SSHGatewayClient) SetUserKeys(ctx context.Context, user string, keys UserKeys) error {
	if keys.Groups == nil {
		keys.Groups = []string{}
	}
	if keys.Keys == nil {
		keys.Keys = []string{}
	}
	err := g.c.do(ctx, http.MethodPut, "/v1/users/"+url.PathEscape(user)+"/keys", keys, nil)
	if se, ok := errors.AsType[*StatusError](err); ok && se.Status == http.StatusConflict {
		claimed := &KeysClaimedError{}
		for _, d := range se.Errors {
			for i := range keys.Keys {
				if d.Location == keyLocation(i) {
					claimed.Keys = append(claimed.Keys, i)
				}
			}
		}
		return claimed
	}
	return err
}

func (g *SSHGatewayClient) KeyRequest(ctx context.Context, code string) (KeyRequest, error) {
	var r KeyRequest
	err := g.c.do(ctx, http.MethodGet, "/v1/key-requests/"+url.PathEscape(code), nil, &r)
	return r, err
}

// SSHSessions is the api's internal API for the ssh-gateway: it resolves the
// session named by an SSH user name, takes tunnel traffic as activity and
// keeps the gateway's audit events in the api's audit store.
type SSHSessions interface {
	SSHSession(ctx context.Context, slug string) (SSHSession, error)
	SSHActivity(ctx context.Context, slug string) error
	RecordAudit(ctx context.Context, events []audit.Event) error
}

type auditEventsInput struct {
	Body []audit.Event `maxItems:"1000"`
}

type SSHSession struct {
	Provider  string       `json:"provider"`
	ID        string       `json:"id"`
	Owner     string       `json:"owner"`
	State     SessionState `json:"state" enum:"provisioning,booting,installing,instrumenting,ready,stopping,failed"`
	TunnelURL string       `json:"tunnelUrl,omitempty"`
}

type slugInput struct {
	Slug string `path:"slug" minLength:"1" maxLength:"200"`
}

func RegisterSSHSessions(api huma.API, s SSHSessions) {
	tags := []string{"ssh-gateway"}

	huma.Register(api, huma.Operation{OperationID: "getSSHSession", Method: http.MethodGet, Path: "/internal/sessions/{slug}", Tags: tags},
		func(ctx context.Context, in *slugInput) (*body[SSHSession], error) {
			sess, err := s.SSHSession(ctx, in.Slug)
			if err != nil {
				return nil, toHuma(err)
			}
			return &body[SSHSession]{sess}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "sshActivity", Method: http.MethodPost, Path: "/internal/sessions/{slug}/activity", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *slugInput) (*struct{}, error) {
		return nil, toHuma(s.SSHActivity(ctx, in.Slug))
	})

	huma.Register(api, huma.Operation{
		OperationID: "recordAudit", Method: http.MethodPost, Path: "/internal/audit/events", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *auditEventsInput) (*struct{}, error) {
		return nil, toHuma(s.RecordAudit(ctx, in.Body))
	})
}

type SSHSessionsClient struct{ c client }

func NewSSHSessionsClient(baseURL string, hc *http.Client) *SSHSessionsClient {
	return &SSHSessionsClient{newClient(baseURL, hc)}
}

func (c *SSHSessionsClient) SSHSession(ctx context.Context, slug string) (SSHSession, error) {
	var s SSHSession
	err := c.c.do(ctx, http.MethodGet, "/internal/sessions/"+url.PathEscape(slug), nil, &s)
	return s, err
}

func (c *SSHSessionsClient) SSHActivity(ctx context.Context, slug string) error {
	return c.c.do(ctx, http.MethodPost, "/internal/sessions/"+url.PathEscape(slug)+"/activity", nil, nil)
}

func (c *SSHSessionsClient) RecordAudit(ctx context.Context, events []audit.Event) error {
	return c.c.do(ctx, http.MethodPost, "/internal/audit/events", events, nil)
}
