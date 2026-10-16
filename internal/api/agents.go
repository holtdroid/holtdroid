package api

import (
	"context"
	"errors"
	"net/url"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/kriakiku/holtdroid/internal/contract"
)

var errNoAgent = errors.New("session has no agent yet")

// agentURLs remembers where session agents are for a few seconds: one page
// load proxies dozens of requests, and each would otherwise ask the provider.
type agentURLs struct {
	ttl time.Duration
	now func() time.Time
	sf  singleflight.Group

	mu sync.Mutex
	m  map[sessionKey]agentURL
}

type agentURL struct {
	url *url.URL
	at  time.Time
}

func newAgentURLs(ttl time.Duration, now func() time.Time) *agentURLs {
	return &agentURLs{ttl: ttl, now: now, m: map[sessionKey]agentURL{}}
}

func (c *agentURLs) get(ctx context.Context, key sessionKey, p contract.Provider) (*url.URL, error) {
	if u := c.cached(key); u != nil {
		return u, nil
	}
	v, err, _ := c.sf.Do(key.Provider+"/"+key.ID, func() (any, error) {
		if u := c.cached(key); u != nil {
			return u, nil
		}
		sess, err := p.Get(context.WithoutCancel(ctx), key.ID)
		if err != nil {
			return nil, err
		}
		u, err := url.Parse(sess.AgentURL)
		if err != nil || sess.AgentURL == "" {
			return nil, errNoAgent
		}
		c.mu.Lock()
		now := c.now()
		for k, e := range c.m {
			if now.Sub(e.at) >= c.ttl {
				delete(c.m, k)
			}
		}
		c.m[key] = agentURL{url: u, at: now}
		c.mu.Unlock()
		return u, nil
	})
	if err != nil {
		return nil, err
	}
	return v.(*url.URL), nil
}

func (c *agentURLs) cached(key sessionKey) *url.URL {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.m[key]; ok && c.now().Sub(e.at) < c.ttl {
		return e.url
	}
	return nil
}

func (c *agentURLs) forget(key sessionKey) {
	c.mu.Lock()
	delete(c.m, key)
	c.mu.Unlock()
}
