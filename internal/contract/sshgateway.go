package contract

import (
	"context"
	"net/http"
	"net/url"

	"github.com/danielgtaylor/huma/v2"

	"github.com/holtdroid/holtdroid/internal/audit"
	"github.com/holtdroid/holtdroid/internal/contract/control"
)

// SSHGateway is the internal API every ssh-gateway replica serves to the api.
type SSHGateway interface {
	HostKeys(ctx context.Context) ([]string, error)
	Computers(ctx context.Context, user string) ([]control.Computer, error)
	SetPublished(ctx context.Context, user, computer string, ports []int) error
}

type hostKeys struct {
	Keys []string `json:"keys" doc:"authorized_keys lines of the gateway's host keys"`
}

type computers struct {
	Computers []control.Computer `json:"computers"`
}

type userInput struct {
	User string `path:"user" minLength:"1"`
}

type publishedInput struct {
	User     string `path:"user" minLength:"1"`
	Computer string `path:"computer" minLength:"1"`
	Body     struct {
		Ports []int `json:"ports" maxItems:"256"`
	}
}

func RegisterSSHGateway(api huma.API, g SSHGateway) {
	tags := []string{"ssh-gateway"}

	huma.Register(api, huma.Operation{OperationID: "getHostKeys", Method: http.MethodGet, Path: "/v1/host-keys", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*body[hostKeys], error) {
			keys, err := g.HostKeys(ctx)
			if err != nil {
				return nil, toHuma(err)
			}
			return &body[hostKeys]{hostKeys{keys}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "listComputers", Method: http.MethodGet, Path: "/v1/users/{user}/computers", Tags: tags},
		func(ctx context.Context, in *userInput) (*body[computers], error) {
			list, err := g.Computers(ctx, in.User)
			if err != nil {
				return nil, toHuma(err)
			}
			if list == nil {
				list = []control.Computer{}
			}
			return &body[computers]{computers{list}}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "setPublished", Method: http.MethodPut, Path: "/v1/users/{user}/computers/{computer}/published", Tags: tags,
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *publishedInput) (*struct{}, error) {
		return nil, toHuma(g.SetPublished(ctx, in.User, in.Computer, in.Body.Ports))
	})

	registerHealth(api, "ssh-gateway")
}

type SSHGatewayClient struct{ c client }

func NewSSHGatewayClient(baseURL string, hc *http.Client) *SSHGatewayClient {
	return &SSHGatewayClient{newClient(baseURL, hc)}
}

func (g *SSHGatewayClient) HostKeys(ctx context.Context) ([]string, error) {
	var out hostKeys
	err := g.c.do(ctx, http.MethodGet, "/v1/host-keys", nil, &out)
	return out.Keys, err
}

func (g *SSHGatewayClient) Computers(ctx context.Context, user string) ([]control.Computer, error) {
	var out computers
	err := g.c.do(ctx, http.MethodGet, "/v1/users/"+url.PathEscape(user)+"/computers", nil, &out)
	return out.Computers, err
}

func (g *SSHGatewayClient) SetPublished(ctx context.Context, user, computer string, ports []int) error {
	if ports == nil {
		ports = []int{}
	}
	return g.c.do(ctx, http.MethodPut, "/v1/users/"+url.PathEscape(user)+"/computers/"+url.PathEscape(computer)+"/published",
		struct {
			Ports []int `json:"ports"`
		}{ports}, nil)
}

// SSHSessions is the api's internal API for the ssh-gateway: it resolves the
// sessions behind an SSH user name, takes tunnel traffic as activity, names
// the certificate authority that signs connect clients' keys and keeps the
// gateway's audit events in the api's audit store.
type SSHSessions interface {
	SSHActivity(ctx context.Context, slug string) error
	SSHUserSessions(ctx context.Context, handle string) ([]SSHSession, error)
	SSHAuthority(ctx context.Context) (string, error)
	RecordAudit(ctx context.Context, events []audit.Event) error
}

type auditEventsInput struct {
	Body []audit.Event `maxItems:"1000"`
}

type SSHSession struct {
	Provider    string       `json:"provider"`
	ID          string       `json:"id"`
	Owner       string       `json:"owner"`
	State       SessionState `json:"state" enum:"provisioning,booting,installing,restoring,instrumenting,ready,stopping,failed"`
	TunnelURL   string       `json:"tunnelUrl,omitempty"`
	Package     string       `json:"package,omitempty"`
	Label       string       `json:"label,omitempty" doc:"the app's name, once the api has parsed its APK"`
	VersionName string       `json:"versionName,omitempty"`
}

// HandlePrefix starts the SSH user name that reaches all of a user's
// sessions at once, so "user" can't be a provider name.
const HandlePrefix = "user-"

type SSHUserSessions struct {
	Sessions []SSHSession `json:"sessions" doc:"every session of the user behind the handle, in any state"`
}

type handleInput struct {
	Handle string `path:"handle" minLength:"1" maxLength:"200"`
}

type slugInput struct {
	Slug string `path:"slug" minLength:"1" maxLength:"200"`
}

func RegisterSSHSessions(api huma.API, s SSHSessions) {
	tags := []string{"ssh-gateway"}

	huma.Register(api, huma.Operation{
		OperationID: "sshActivity", Method: http.MethodPost, Path: "/internal/sessions/{slug}/activity", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *slugInput) (*struct{}, error) {
		return nil, toHuma(s.SSHActivity(ctx, in.Slug))
	})

	huma.Register(api, huma.Operation{OperationID: "getSSHUserSessions", Method: http.MethodGet, Path: "/internal/users/{handle}/sessions", Tags: tags},
		func(ctx context.Context, in *handleInput) (*body[SSHUserSessions], error) {
			sessions, err := s.SSHUserSessions(ctx, in.Handle)
			if err != nil {
				return nil, toHuma(err)
			}
			if sessions == nil {
				sessions = []SSHSession{}
			}
			return &body[SSHUserSessions]{SSHUserSessions{sessions}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "getSSHAuthority", Method: http.MethodGet, Path: "/internal/ssh/authority", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*body[sshAuthority], error) {
			key, err := s.SSHAuthority(ctx)
			if err != nil {
				return nil, toHuma(err)
			}
			return &body[sshAuthority]{sshAuthority{key}}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "recordAudit", Method: http.MethodPost, Path: "/internal/audit/events", Tags: tags, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *auditEventsInput) (*struct{}, error) {
		return nil, toHuma(s.RecordAudit(ctx, in.Body))
	})
}

type sshAuthority struct {
	PublicKey string `json:"publicKey" doc:"authorized_keys line of the user CA"`
}

type SSHSessionsClient struct{ c client }

func NewSSHSessionsClient(baseURL string, hc *http.Client) *SSHSessionsClient {
	return &SSHSessionsClient{newClient(baseURL, hc)}
}

func (c *SSHSessionsClient) SSHUserSessions(ctx context.Context, handle string) ([]SSHSession, error) {
	var out SSHUserSessions
	err := c.c.do(ctx, http.MethodGet, "/internal/users/"+url.PathEscape(handle)+"/sessions", nil, &out)
	return out.Sessions, err
}

func (c *SSHSessionsClient) SSHActivity(ctx context.Context, slug string) error {
	return c.c.do(ctx, http.MethodPost, "/internal/sessions/"+url.PathEscape(slug)+"/activity", nil, nil)
}

func (c *SSHSessionsClient) RecordAudit(ctx context.Context, events []audit.Event) error {
	return c.c.do(ctx, http.MethodPost, "/internal/audit/events", events, nil)
}

func (c *SSHSessionsClient) SSHAuthority(ctx context.Context) (string, error) {
	var out sshAuthority
	err := c.c.do(ctx, http.MethodGet, "/internal/ssh/authority", nil, &out)
	return out.PublicKey, err
}
