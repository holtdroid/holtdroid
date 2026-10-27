package dns

import "github.com/holtdroid/holtdroid/internal/contract"

// encrypted are the names of well-known DNS-over-HTTPS and DNS-over-TLS
// servers: Chrome's automatic upgrade list (net/dns/public/doh_provider_entry.cc)
// and the ones apps bundle most.
var encrypted = compileEncrypted(
	"cloudflare-dns.com", "*.cloudflare-dns.com",
	"dns.google", "*.dns.google",
	"dns.quad9.net", "dns9.quad9.net", "dns10.quad9.net", "dns11.quad9.net", "dns12.quad9.net",
	"doh.opendns.com", "doh.familyshield.opendns.com", "doh.umbrella.com",
	"doh.cleanbrowsing.org", "*.doh.cleanbrowsing.org",
	"dns.nextdns.io", "*.dns.nextdns.io",
	"*.adguard-dns.com", "dns.adguard.com",
	"doh.dns.sb", "dot.sb",
	"dns0.eu", "*.dns0.eu",
	"protective.joindns4.eu", "unfiltered.joindns4.eu", "child.joindns4.eu", "noads.joindns4.eu", "child-noads.joindns4.eu",
	"dns.alidns.com", "doh.pub", "dot.pub",
	"doh.xfinity.com", "doh.cox.net", "doh-01.spectrum.com", "doh-02.spectrum.com",
	"doh.quickline.ch", "odvr.nic.cz", "public.dns.iij.jp", "dns.levonet.sk", "dns.switch.ch",
)

const encryptedRule = "encrypted DNS"

func compileEncrypted(patterns ...string) []rule {
	out := make([]rule, len(patterns))
	for i, p := range patterns {
		out[i] = rule{Pattern: p, Kind: contract.DNSRewriteNXDomain, Enabled: true}
	}
	return out
}
