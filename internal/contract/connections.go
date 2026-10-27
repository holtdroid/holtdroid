package contract

import "time"

// Connection is one of the device's connections as its VPN sidecar saw it:
// a line when it opens, again while its traffic grows, and once it closes.
type Connection struct {
	ID       string    `json:"id"`
	Start    time.Time `json:"start"`
	End      time.Time `json:"end,omitzero" doc:"when it was gone; none while it is open"`
	Network  string    `json:"network" enum:"tcp,udp"`
	Host     string    `json:"host,omitempty" doc:"the name sniffed from TLS, HTTP or QUIC; none for a bare address"`
	Address  string    `json:"address,omitempty" doc:"the server's IP address; none when the device asked a proxy for a name"`
	Port     int       `json:"port"`
	Outbound string    `json:"outbound,omitempty" doc:"the VPN location, direct or bypass it left through"`
	Edge     string    `json:"edge,omitempty" doc:"the CDN site that answered, an IATA code such as VNO, when the agent asked the CDN"`
	Upload   int64     `json:"upload" doc:"bytes sent"`
	Download int64     `json:"download" doc:"bytes received"`
}

type ConnectionsState struct {
	Available bool `json:"available" doc:"the device's connections go through a VPN sidecar that reports them"`
}

// IPInfo is where an address is, from the geolocation databases of the
// api. Country and ASN may be missing when the api has no database.
type IPInfo struct {
	Address   string `json:"address"`
	Country   string `json:"country,omitempty" doc:"ISO 3166-1 alpha-2"`
	Continent string `json:"continent,omitempty" enum:"AF,AN,AS,EU,NA,OC,SA"`
	ASN       uint   `json:"asn,omitempty"`
	Org       string `json:"org,omitempty" doc:"the autonomous system's name"`
	CDN       string `json:"cdn,omitempty" enum:"cloudflare,fastly,google" doc:"the CDN whose published edge ranges hold it: anycast, so its country is where it is registered, not the site that answers"`
	Private   bool   `json:"private,omitempty" doc:"a private, loopback or link-local address"`
}
