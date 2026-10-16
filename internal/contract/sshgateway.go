package contract

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"

	"github.com/danielgtaylor/huma/v2"
)

// SSHGateway is the internal API every ssh-gateway replica serves to the api.
type SSHGateway interface {
	SetUserKeys(ctx context.Context, user string, keys UserKeys) error
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
