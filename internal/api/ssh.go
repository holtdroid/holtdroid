package api

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/contract"
)

type SSHInfo struct {
	Enabled      bool   `json:"enabled"`
	Host         string `json:"host,omitempty" doc:"Host users connect to; empty means the host the UI is served from"`
	Port         int    `json:"port"`
	AllowADB     bool   `json:"allowADB"`
	AllowReverse bool   `json:"allowReverse"`
	MaxTunnels   int    `json:"maxTunnels" doc:"tunnels one connection may open"`
	Handle       string `json:"handle,omitempty" doc:"the caller's SSH user name"`
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
		OperationID: "listSSHTunnels", Method: http.MethodGet, Path: "/api/v1/ssh/tunnels", Tags: tags,
		Description: "The caller's SSH tunnels that are open right now, by session.",
	}, func(ctx context.Context, _ *struct{}) (*out[SSHTunnelList], error) {
		if !s.cfg.SSH.Enabled {
			return &out[SSHTunnelList]{SSHTunnelList{Sessions: []SSHTunnels{}}}, nil
		}
		who, _ := auth.FromContext(ctx)
		return &out[SSHTunnelList]{s.sshTunnels(ctx, who.User)}, nil
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
		AllowADB: c.AllowADB, AllowReverse: c.AllowReverse, MaxTunnels: c.MaxTunnelsPerConnection,
	}
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

// sshSession resolves a session slug, "{provider}-{id}".
func (s *Server) sshSession(ctx context.Context, slug string) (contract.SSHSession, error) {
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
	sess, err := s.sshSession(ctx, slug)
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

// SSHTunnels are the caller's SSH tunnels into one session.
type SSHTunnels struct {
	Provider string                   `json:"provider"`
	ID       string                   `json:"id"`
	ADB      []contract.ADBTunnel     `json:"adb"`
	Reverse  []contract.ReverseTunnel `json:"reverse"`
}

type SSHTunnelList struct {
	Sessions []SSHTunnels `json:"sessions" doc:"only sessions where the caller has a tunnel open"`
}

// sshTunnels asks the agent of every ready session for what is open and
// keeps the caller's SSH tunnels. Agents that don't answer are left out.
func (s *Server) sshTunnels(ctx context.Context, user string) SSHTunnelList {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	all, _ := s.allSessions(ctx)
	var ready []sessionKey
	for _, provider := range s.provOrder {
		for _, sess := range all[provider] {
			if sess.State == contract.StateReady {
				ready = append(ready, sessionKey{provider, sess.ID})
			}
		}
	}
	found := make([]SSHTunnels, len(ready))
	var wg sync.WaitGroup
	for i, key := range ready {
		wg.Go(func() {
			u, err := s.agents.get(ctx, key, s.providers[key.Provider])
			if err != nil {
				return
			}
			t, err := contract.NewAgentClient(u.String(), &http.Client{Transport: s.agentTransport}).Tunnels(ctx)
			if err != nil {
				s.log.Debug("session tunnels", "provider", key.Provider, "id", key.ID, "err", err)
				return
			}
			mine := SSHTunnels{Provider: key.Provider, ID: key.ID, ADB: []contract.ADBTunnel{}, Reverse: []contract.ReverseTunnel{}}
			for _, a := range t.ADB {
				if a.Client == contract.ADBClientSSH && a.User == user {
					mine.ADB = append(mine.ADB, a)
				}
			}
			for _, r := range t.Reverse {
				if r.User == user {
					mine.Reverse = append(mine.Reverse, r)
				}
			}
			found[i] = mine
		})
	}
	wg.Wait()
	out := SSHTunnelList{Sessions: []SSHTunnels{}}
	for _, t := range found {
		if len(t.ADB)+len(t.Reverse) > 0 {
			out.Sessions = append(out.Sessions, t)
		}
	}
	return out
}
