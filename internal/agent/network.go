package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/vpn"
)

// Network reports the egress IP and switches the VPN location through the
// sing-box sidecar's clash API. Without a clash API the location is "direct".
type Network struct {
	clash  string
	ipInfo string
	hc     *http.Client
	ipHC   *http.Client

	mu      sync.Mutex
	cached  contract.Network
	checked time.Time
}

// NewNetwork asks ipInfoURL for the egress IP through proxy when it is set,
// so a device whose traffic leaves through another host reports that one.
func NewNetwork(clashAPI, ipInfoURL, proxy string) *Network {
	n := &Network{clash: strings.TrimRight(clashAPI, "/"), ipInfo: ipInfoURL, hc: &http.Client{Timeout: 10 * time.Second}}
	n.ipHC = n.hc
	if u, err := url.Parse(proxy); proxy != "" && err == nil {
		n.ipHC = &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{Proxy: http.ProxyURL(u)}}
	}
	return n
}

func (n *Network) Get(ctx context.Context) (contract.Network, error) {
	n.mu.Lock()
	if !n.checked.IsZero() && time.Since(n.checked) < 30*time.Second {
		defer n.mu.Unlock()
		return n.cached, nil
	}
	n.mu.Unlock()

	loc := vpn.Direct
	if n.clash != "" {
		var sel struct {
			Now string `json:"now"`
		}
		if err := n.call(ctx, http.MethodGet, "/proxies/"+vpn.Selector, nil, &sel); err != nil {
			return contract.Network{}, err
		}
		loc = sel.Now
	}
	out := contract.Network{Location: loc}
	if n.ipInfo != "" {
		var info struct {
			IP      string `json:"ip"`
			Country string `json:"country"`
		}
		if err := n.getJSON(ctx, n.ipInfo, &info); err == nil {
			out.ExternalIP, out.Country = info.IP, info.Country
		}
	}

	n.mu.Lock()
	n.cached, n.checked = out, time.Now()
	n.mu.Unlock()
	return out, nil
}

func (n *Network) SetLocation(ctx context.Context, location string) (contract.Network, error) {
	if n.clash == "" {
		if location != vpn.Direct {
			return contract.Network{}, fmt.Errorf("%w: this device has no VPN", contract.ErrInvalid)
		}
		return n.Get(ctx)
	}
	if err := n.call(ctx, http.MethodPut, "/proxies/"+vpn.Selector, map[string]string{"name": location}, nil); err != nil {
		return contract.Network{}, err
	}
	n.mu.Lock()
	n.checked = time.Time{}
	n.mu.Unlock()
	n.hc.CloseIdleConnections()
	n.ipHC.CloseIdleConnections()
	return n.Get(ctx)
}

func (n *Network) call(ctx context.Context, method, path string, in, out any) error {
	var body bytes.Buffer
	if in != nil {
		if err := json.NewEncoder(&body).Encode(in); err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, n.clash+path, &body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusBadRequest:
		return fmt.Errorf("%w: clash api %s %s: %s", contract.ErrInvalid, method, path, resp.Status)
	case resp.StatusCode >= 300:
		return fmt.Errorf("clash api %s %s: %s", method, path, resp.Status)
	case out == nil:
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (n *Network) getJSON(ctx context.Context, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := n.ipHC.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: %s", url, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

type clashConnections struct {
	Connections []struct {
		ID       string `json:"id"`
		Metadata struct {
			Network         string `json:"network"`
			Type            string `json:"type"`
			DestinationIP   string `json:"destinationIP"`
			DestinationPort string `json:"destinationPort"`
			Host            string `json:"host"`
		} `json:"metadata"`
		Upload   int64     `json:"upload"`
		Download int64     `json:"download"`
		Start    time.Time `json:"start"`
		Chains   []string  `json:"chains"`
	} `json:"connections"`
}

// Connections lists the device's open connections, without the agent's own
// and the DNS forwarding's.
func (n *Network) Connections(ctx context.Context) ([]contract.Connection, error) {
	var in clashConnections
	if err := n.call(ctx, http.MethodGet, "/connections", nil, &in); err != nil {
		return nil, err
	}
	out := make([]contract.Connection, 0, len(in.Connections))
	for _, c := range in.Connections {
		_, inbound, _ := strings.Cut(c.Metadata.Type, "/")
		addr, err := netip.ParseAddr(c.Metadata.DestinationIP)
		if vpn.Own(inbound, c.Chains) || err != nil || addr.IsLoopback() {
			continue
		}
		port, _ := strconv.Atoi(c.Metadata.DestinationPort)
		out = append(out, contract.Connection{
			ID: c.ID, Start: c.Start, Network: c.Metadata.Network, Host: c.Metadata.Host,
			Address: addr.Unmap().String(), Port: port, Outbound: firstOf(c.Chains),
			Upload: c.Upload, Download: c.Download,
		})
	}
	return out, nil
}

// firstOf is the outbound a connection left through: clash lists the chain
// from the last hop back to the selector.
func firstOf(chains []string) string {
	if len(chains) == 0 {
		return ""
	}
	return chains[0]
}
