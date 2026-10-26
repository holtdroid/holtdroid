package contract

import "time"

type DNSTTLMode string

const (
	DNSTTLKeep  DNSTTLMode = "keep"
	DNSTTLLimit DNSTTLMode = "limit"
)

type DNSRewriteKind string

const (
	DNSRewriteAddress  DNSRewriteKind = "address"
	DNSRewriteCNAME    DNSRewriteKind = "cname"
	DNSRewriteNXDomain DNSRewriteKind = "nxdomain"
)

// DNSRewrite answers names matching Pattern itself instead of asking the
// upstream. An exact name wins over a wildcard, a longer wildcard over a
// shorter one.
type DNSRewrite struct {
	Pattern   string         `json:"pattern" maxLength:"255" doc:"a name such as api.example.com, or *.example.com for every name under example.com"`
	Kind      DNSRewriteKind `json:"kind" enum:"address,cname,nxdomain"`
	Addresses []string       `json:"addresses,omitempty" maxItems:"16" doc:"IPv4 addresses answered to A queries (kind address); 0.0.0.0 blocks the name"`
	Target    string         `json:"target,omitempty" maxLength:"255" doc:"the name answered as a CNAME and resolved in its place (kind cname)"`
	TTL       uint32         `json:"ttl" maximum:"86400" doc:"seconds the device may keep the answer"`
	Enabled   bool           `json:"enabled"`
}

type DNSSettings struct {
	TTLMode  DNSTTLMode   `json:"ttlMode" enum:"keep,limit" doc:"limit caps every TTL the device gets at maxTtl; 0 keeps Android from caching"`
	MaxTTL   uint32       `json:"maxTtl" maximum:"86400"`
	Rewrites []DNSRewrite `json:"rewrites" maxItems:"500"`
}

type DNSState struct {
	Available bool        `json:"available" doc:"the device's DNS goes through the agent; false without a VPN sidecar"`
	Settings  DNSSettings `json:"settings"`
}

type DNSResult string

const (
	DNSAnswered  DNSResult = "answered"
	DNSRewritten DNSResult = "rewritten"
	DNSIPv4Only  DNSResult = "ipv4-only"
	DNSFailed    DNSResult = "failed"
)

type DNSAnswer struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Data        string `json:"data"`
	TTL         uint32 `json:"ttl" doc:"seconds the device was told to keep it"`
	OriginalTTL uint32 `json:"originalTtl" doc:"what the upstream answered; the rule's TTL for a rewrite"`
}

// DNSQuery is one query from the device and how it was answered.
type DNSQuery struct {
	ID       int64       `json:"id"`
	At       time.Time   `json:"at"`
	Name     string      `json:"name"`
	Type     string      `json:"type" doc:"A, AAAA, HTTPS, … or TYPE<n>"`
	Protocol string      `json:"protocol" enum:"udp,tcp"`
	Result   DNSResult   `json:"result" enum:"answered,rewritten,ipv4-only,failed"`
	Rcode    string      `json:"rcode" doc:"NOERROR, NXDOMAIN, SERVFAIL, …"`
	Answers  []DNSAnswer `json:"answers"`
	Rule     string      `json:"rule,omitempty" doc:"the pattern of the rewrite that answered"`
	Duration float64     `json:"duration" doc:"milliseconds until the answer"`
	Error    string      `json:"error,omitempty"`
}

// DNSEvent is one line of the DNS log: a query, the settings after a change,
// or the device's cache being cleared.
type DNSEvent struct {
	At       time.Time    `json:"at"`
	Query    *DNSQuery    `json:"query,omitempty"`
	Settings *DNSSettings `json:"settings,omitempty"`
	Flushed  bool         `json:"flushed,omitempty"`
}
