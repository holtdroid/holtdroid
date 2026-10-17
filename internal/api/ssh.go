package api

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kriakiku/holtdroid/internal/audit"
	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/sshkey"
)

type SSHInfo struct {
	Enabled          bool   `json:"enabled"`
	Host             string `json:"host,omitempty" doc:"Host users connect to; empty means the host the UI is served from"`
	Port             int    `json:"port"`
	AllowADB         bool   `json:"allowADB"`
	AllowReverse     bool   `json:"allowReverse"`
	ClientIsolation  bool   `json:"clientIsolation"`
	MaxTunnels       int    `json:"maxTunnels" doc:"tunnels one SSH connection may open"`
	KeyRequests      bool   `json:"keyRequests" doc:"the gateway offers a link to add an unknown key"`
	SkipHostKeyCheck bool   `json:"skipHostKeyCheck" doc:"commands turn off host key checking"`
	Handle           string `json:"handle,omitempty" doc:"the caller's SSH user name for publishing ports on all of their sessions at once"`
}

type SSHKeyRequest struct {
	PublicKey   string    `json:"publicKey" doc:"OpenSSH public key line"`
	Fingerprint string    `json:"fingerprint"`
	Session     string    `json:"session" doc:"SSH user name the connection asked for"`
	ClientIP    string    `json:"clientIP"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type keyRequestInput struct {
	Code string `path:"code" pattern:"^[a-z2-7]{16}$"`
}

type SSHKeyInput struct {
	Name      string `json:"name" maxLength:"100"`
	PublicKey string `json:"publicKey" minLength:"1" maxLength:"8192" doc:"OpenSSH public key line"`
}

type SSHKeysSynced struct {
	Replicas int `json:"replicas" doc:"ssh-gateway replicas that accepted the keys"`
}

type putSSHKeysInput struct {
	Body struct {
		Keys []SSHKeyInput `json:"keys" maxItems:"32"`
	}
}

func WithResolver(lookup func(ctx context.Context, host string) ([]string, error)) Option {
	return func(s *Server) { s.lookupHost = lookup }
}

func (s *Server) registerSSH(api huma.API) {
	tags := []string{"ssh"}

	huma.Register(api, huma.Operation{OperationID: "getSSH", Method: http.MethodGet, Path: "/api/v1/ssh", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*out[SSHInfo], error) {
			info := s.sshInfo()
			if who, ok := auth.FromContext(ctx); ok && info.Enabled {
				info.Handle = s.sshHandle(who.User)
			}
			return &out[SSHInfo]{info}, nil
		})

	huma.Register(api, huma.Operation{
		OperationID: "putSSHKeys", Method: http.MethodPut, Path: "/api/v1/ssh/keys", Tags: tags,
		Description: "Replace the caller's SSH public keys on every ssh-gateway replica.",
	}, func(ctx context.Context, in *putSSHKeysInput) (*out[SSHKeysSynced], error) {
		if !s.cfg.SSH.Enabled {
			return nil, huma.Error404NotFound("SSH access is not enabled")
		}
		lines, err := parseSSHKeys(in.Body.Keys)
		if err != nil {
			return nil, err
		}
		who, _ := auth.FromContext(ctx)
		replicas, err := s.pushSSHKeys(ctx, who, lines)
		s.emitResult(ctx, audit.Event{Action: audit.SSHKeys, Details: map[string]string{
			"keys": strconv.Itoa(len(lines)), "fingerprints": fingerprints(lines), "replicas": strconv.Itoa(replicas),
		}}, err)
		if claimed, ok := errors.AsType[*contract.KeysClaimedError](err); ok {
			details := make([]error, 0, len(claimed.Keys))
			for _, i := range claimed.Keys {
				details = append(details, keyError(i, "this key is already registered by another user"))
			}
			return nil, huma.Error422UnprocessableEntity("some keys are registered by another user", details...)
		}
		if err != nil {
			return nil, huma.Error502BadGateway(err.Error())
		}
		return &out[SSHKeysSynced]{SSHKeysSynced{Replicas: replicas}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "getSSHKeyRequest", Method: http.MethodGet, Path: "/api/v1/ssh/key-requests/{code}", Tags: tags,
		Description: "An SSH connection waiting for its key to be added, from the link the gateway printed.",
	}, func(ctx context.Context, in *keyRequestInput) (*out[SSHKeyRequest], error) {
		if !s.cfg.SSH.Enabled {
			return nil, huma.Error404NotFound("SSH access is not enabled")
		}
		r, err := s.findKeyRequest(ctx, in.Code)
		switch {
		case errors.Is(err, contract.ErrNotFound):
			return nil, huma.Error404NotFound("no connection is waiting with this link; run ssh again for a new one")
		case err != nil:
			return nil, huma.Error502BadGateway(err.Error())
		}
		return &out[SSHKeyRequest]{SSHKeyRequest(r)}, nil
	})
}

func (s *Server) sshInfo() SSHInfo {
	c := s.cfg.SSH
	if !c.Enabled {
		return SSHInfo{}
	}
	host := c.PublicHost
	if host == "" {
		if u, err := url.Parse(s.cfg.PublicURL); err == nil {
			host = u.Hostname()
		}
	}
	return SSHInfo{
		Enabled: true, Host: host, Port: c.PublicPort,
		AllowADB: c.AllowADB, AllowReverse: c.AllowReverse, ClientIsolation: c.ClientIsolation,
		MaxTunnels: c.MaxTunnelsPerConnection, KeyRequests: c.KeyRequests, SkipHostKeyCheck: c.SkipHostKeyCheck,
	}
}

func keyError(i int, msg string) error {
	return &huma.ErrorDetail{Message: msg, Location: fmt.Sprintf("body.keys[%d].publicKey", i)}
}

func parseSSHKeys(keys []SSHKeyInput) ([]string, error) {
	lines := make([]string, 0, len(keys))
	seen := map[string]int{}
	var details []error
	for i, k := range keys {
		key, err := sshkey.Parse(k.PublicKey)
		if err != nil {
			details = append(details, keyError(i, err.Error()))
			continue
		}
		if j, dup := seen[key.Fingerprint]; dup {
			details = append(details, keyError(i, fmt.Sprintf("same key as keys[%d]", j)))
			continue
		}
		seen[key.Fingerprint] = i
		lines = append(lines, key.AuthorizedKey())
	}
	if len(details) > 0 {
		return nil, huma.Error422UnprocessableEntity("invalid SSH keys", details...)
	}
	return lines, nil
}

func fingerprints(lines []string) string {
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		if k, err := sshkey.Parse(l); err == nil {
			out = append(out, k.Fingerprint)
		}
	}
	return strings.Join(out, ",")
}

func (s *Server) pushSSHKeys(ctx context.Context, who auth.Identity, lines []string) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	urls, err := s.gatewayReplicas(ctx)
	if err != nil {
		return 0, err
	}
	keys := contract.UserKeys{Handle: s.sshHandle(who.User), Groups: who.Groups, Admin: who.Admin, Keys: lines}
	errs := make([]error, len(urls))
	var wg sync.WaitGroup
	for i, u := range urls {
		wg.Go(func() {
			errs[i] = contract.NewSSHGatewayClient(u, s.sshHTTP).SetUserKeys(ctx, who.User, keys)
		})
	}
	wg.Wait()

	ok := 0
	var failed []error
	for i, err := range errs {
		if _, claimed := errors.AsType[*contract.KeysClaimedError](err); claimed {
			return 0, err
		}
		if err != nil {
			s.log.Warn("ssh-gateway replica rejected keys", "replica", urls[i], "user", who.User, "err", err)
			failed = append(failed, err)
			continue
		}
		ok++
	}
	if ok == 0 {
		return 0, fmt.Errorf("no ssh-gateway replica accepted the keys: %w", errors.Join(failed...))
	}
	return ok, nil
}

// findKeyRequest asks every replica, since only the one holding the
// connection knows the code.
func (s *Server) findKeyRequest(ctx context.Context, code string) (contract.KeyRequest, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	urls, err := s.gatewayReplicas(ctx)
	if err != nil {
		return contract.KeyRequest{}, err
	}
	found := make([]contract.KeyRequest, len(urls))
	errs := make([]error, len(urls))
	var wg sync.WaitGroup
	for i, u := range urls {
		wg.Go(func() {
			found[i], errs[i] = contract.NewSSHGatewayClient(u, s.sshHTTP).KeyRequest(ctx, code)
		})
	}
	wg.Wait()
	var failed []error
	for i, err := range errs {
		switch {
		case err == nil:
			return found[i], nil
		case !errors.Is(err, contract.ErrNotFound):
			s.log.Warn("ssh-gateway replica key request", "replica", urls[i], "err", err)
			failed = append(failed, err)
		}
	}
	if len(failed) == len(urls) {
		return contract.KeyRequest{}, fmt.Errorf("no ssh-gateway replica answered: %w", errors.Join(failed...))
	}
	return contract.KeyRequest{}, contract.ErrNotFound
}

func (s *Server) gatewayReplicas(ctx context.Context) ([]string, error) {
	base, err := url.Parse(s.cfg.SSH.GatewayURL)
	if err != nil {
		return nil, err
	}
	port := base.Port()
	if port == "" {
		port = map[string]string{"https": "443"}[base.Scheme]
		if port == "" {
			port = "80"
		}
	}
	addrs, err := s.lookupHost(ctx, base.Hostname())
	if err != nil {
		return nil, fmt.Errorf("resolve ssh-gateway: %w", err)
	}
	if len(addrs) == 0 {
		return nil, errors.New("no ssh-gateway replicas found")
	}
	urls := make([]string, 0, len(addrs))
	for _, addr := range addrs {
		u := *base
		u.Host = net.JoinHostPort(addr, port)
		urls = append(urls, u.String())
	}
	return urls, nil
}

// SSHSession resolves an SSH user name, "{provider}-{id}", for the gateway.
func (s *Server) SSHSession(ctx context.Context, slug string) (contract.SSHSession, error) {
	names := slices.Clone(s.provOrder)
	slices.SortFunc(names, func(a, b string) int { return len(b) - len(a) })
	for _, name := range names {
		id, ok := strings.CutPrefix(slug, name+"-")
		if !ok || id == "" {
			continue
		}
		sess, err := s.providers[name].Get(ctx, id)
		if errors.Is(err, contract.ErrNotFound) {
			continue
		}
		if err != nil {
			return contract.SSHSession{}, err
		}
		return contract.SSHSession{Provider: name, ID: sess.ID, Owner: sess.Owner, State: sess.State, TunnelURL: sess.TunnelURL}, nil
	}
	return contract.SSHSession{}, fmt.Errorf("%w: session %q", contract.ErrNotFound, slug)
}

func (s *Server) SSHActivity(ctx context.Context, slug string) error {
	sess, err := s.SSHSession(ctx, slug)
	if err != nil {
		return err
	}
	s.activity.Mark(sessionKey{sess.Provider, sess.ID})
	return nil
}

func (s *Server) sshHandle(user string) string {
	return contract.HandlePrefix + s.auth.Pseudonym(user)
}

func (s *Server) SSHUserSessions(ctx context.Context, handle string) ([]contract.SSHSession, error) {
	all, errs := s.allSessions(ctx)
	if len(errs) > 0 {
		return nil, fmt.Errorf("provider %s: %s", errs[0].Source, errs[0].Message)
	}
	var out []contract.SSHSession
	for _, provider := range s.provOrder {
		for _, sess := range all[provider] {
			if sess.Owner != "" && s.sshHandle(sess.Owner) == handle {
				out = append(out, contract.SSHSession{Provider: provider, ID: sess.ID, Owner: sess.Owner, State: sess.State, TunnelURL: sess.TunnelURL})
			}
		}
	}
	return out, nil
}
