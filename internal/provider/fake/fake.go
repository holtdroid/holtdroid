// Package fake is a device provider with simulated devices. It exists for
// UI development and tests; it never runs Android.
package fake

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/kriakiku/holtdroid/internal/contract"
)

type Config struct {
	Listen    string
	Slots     int
	PublicURL string
	StepDelay time.Duration
}

func DefaultConfig() Config {
	return Config{Listen: ":8080", Slots: 4, PublicURL: "http://localhost:8080", StepDelay: 2 * time.Second}
}

var Locations = []contract.Location{
	{ID: "direct", Label: "Direct"},
	{ID: "pl", Label: "Poland"},
	{ID: "de", Label: "Germany"},
	{ID: "us", Label: "United States"},
}

type Provider struct {
	cfg Config
	now func() time.Time

	mu       sync.Mutex
	sessions map[string]*device
}

type Option func(*Provider)

func WithClock(now func() time.Time) Option { return func(p *Provider) { p.now = now } }

func New(cfg Config, opts ...Option) *Provider {
	p := &Provider{cfg: cfg, now: time.Now, sessions: map[string]*device{}}
	for _, opt := range opts {
		opt(p)
	}
	return p
}

func (p *Provider) Capabilities(context.Context) (contract.Capabilities, error) {
	return contract.Capabilities{
		Kind:      "fake",
		Display:   contract.DisplayNoVNC,
		DevTools:  true,
		Clipboard: true,
		Locations: Locations,
		ABIs:      []string{"x86_64", "arm64-v8a"},
	}, nil
}

func (p *Provider) slotIDs() []string {
	ids := make([]string, p.cfg.Slots)
	for i := range ids {
		ids[i] = fmt.Sprintf("fake-%d", i+1)
	}
	return ids
}

func (p *Provider) Capacity(context.Context) (contract.Capacity, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	busy := map[string]bool{}
	for _, d := range p.sessions {
		busy[d.session().Slot] = true
	}
	var c contract.Capacity
	for _, id := range p.slotIDs() {
		state := contract.SlotFree
		if busy[id] {
			state = contract.SlotBusy
		}
		c.Slots = append(c.Slots, contract.Slot{ID: id, Label: "Fake device " + strings.TrimPrefix(id, "fake-"), State: state})
	}
	return c, nil
}

func (p *Provider) List(context.Context) ([]contract.Session, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]contract.Session, 0, len(p.sessions))
	for _, d := range p.sessions {
		out = append(out, d.session())
	}
	slices.SortFunc(out, func(a, b contract.Session) int { return a.CreatedAt.Compare(b.CreatedAt) })
	return out, nil
}

func (p *Provider) Create(_ context.Context, req contract.CreateSession) (contract.Session, error) {
	if req.Location != "" && !slices.ContainsFunc(Locations, func(l contract.Location) bool { return l.ID == req.Location }) {
		return contract.Session{}, fmt.Errorf("%w: unknown location %q", contract.ErrInvalid, req.Location)
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	busy := map[string]bool{}
	for _, d := range p.sessions {
		busy[d.session().Slot] = true
	}
	slot := ""
	for _, id := range p.slotIDs() {
		if !busy[id] {
			slot = id
			break
		}
	}
	if slot == "" {
		return contract.Session{}, contract.ErrNoCapacity
	}

	id := randomID()
	location := cmp.Or(req.Location, "direct")
	d := newDevice(contract.Session{
		ID:           id,
		Slot:         slot,
		Owner:        req.Owner,
		Package:      req.Package,
		ArtifactRef:  req.ArtifactRef,
		Location:     location,
		State:        contract.StateProvisioning,
		AgentURL:     strings.TrimRight(p.cfg.PublicURL, "/") + "/agents/" + id,
		CreatedAt:    p.now().UTC(),
		LastActivity: p.now().UTC(),
	}, p.cfg.StepDelay)
	p.sessions[id] = d
	return d.session(), nil
}

func (p *Provider) device(id string) (*device, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	d, ok := p.sessions[id]
	if !ok {
		return nil, fmt.Errorf("%w: session %s", contract.ErrNotFound, id)
	}
	return d, nil
}

func (p *Provider) Get(_ context.Context, id string) (contract.Session, error) {
	d, err := p.device(id)
	if err != nil {
		return contract.Session{}, err
	}
	return d.session(), nil
}

func (p *Provider) Delete(_ context.Context, id string) error {
	p.mu.Lock()
	d, ok := p.sessions[id]
	delete(p.sessions, id)
	p.mu.Unlock()
	if !ok {
		return fmt.Errorf("%w: session %s", contract.ErrNotFound, id)
	}
	d.stop()
	return nil
}

func (p *Provider) Touch(_ context.Context, id string, at time.Time) error {
	d, err := p.device(id)
	if err != nil {
		return err
	}
	d.touch(at)
	return nil
}

func randomID() string {
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
