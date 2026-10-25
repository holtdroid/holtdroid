// Package netem emulates network conditions on a session's VPN tun with
// tc netem: named links (latency, jitter, bandwidth, loss) and scenarios
// that switch between them over time.
package netem

import (
	"time"

	"github.com/holtdroid/holtdroid/internal/contract"
)

// Link is a network's conditions. Loss is the percent of packets lost in
// each direction; Burst is the mean length of a run of lost packets, 0 for
// independent losses. Down and Up are kbit/s, 0 is unlimited.
type Link struct {
	RTT    time.Duration
	Jitter time.Duration
	Down   int
	Up     int
	Loss   float64
	Burst  int
}

// Step holds a link for a random time between Min and Max; an empty Link
// is an outage, every packet dropped.
type Step struct {
	Link     contract.NetworkProfile
	Min, Max time.Duration
}

// Profile is a link or, with Steps, a scenario that loops through them.
type Profile struct {
	ID          contract.NetworkProfile
	Name        string
	Description string
	Link        Link
	Steps       []Step
}

const (
	lte    contract.NetworkProfile = "lte"
	lteBad contract.NetworkProfile = "lte-weak"
	hspa   contract.NetworkProfile = "3g"
	edge   contract.NetworkProfile = "edge"
	leo    contract.NetworkProfile = "satellite-leo"
	outage contract.NetworkProfile = ""
)

const ms, s = time.Millisecond, time.Second

// Profiles are rough medians from public mobile network reports, rounded so
// they are easy to remember.
var Profiles = []Profile{
	{ID: contract.NetworkFull, Name: "No limits", Description: "The session's own network, nothing emulated."},
	{
		ID: "5g", Name: "5G", Description: "A good 5G cell in a city.",
		Link: Link{RTT: 25 * ms, Jitter: 5 * ms, Down: 150_000, Up: 30_000},
	},
	{
		ID: "lte-good", Name: "Good 4G", Description: "Strong 4G signal outdoors, a quiet cell.",
		Link: Link{RTT: 45 * ms, Jitter: 10 * ms, Down: 30_000, Up: 10_000},
	},
	{
		ID: lte, Name: "Typical 4G", Description: "About the worldwide median of a mobile connection.",
		Link: Link{RTT: 70 * ms, Jitter: 20 * ms, Down: 10_000, Up: 3_000, Loss: 0.5},
	},
	{
		ID: lteBad, Name: "Weak 4G", Description: "Edge of a cell or deep indoors: one bar, losses come in bursts.",
		Link: Link{RTT: 150 * ms, Jitter: 60 * ms, Down: 1_500, Up: 500, Loss: 2, Burst: 3},
	},
	{
		ID: hspa, Name: "3G", Description: "HSPA, still common in rural areas and as a fallback from 4G.",
		Link: Link{RTT: 200 * ms, Jitter: 50 * ms, Down: 1_500, Up: 400, Loss: 1},
	},
	{
		ID: edge, Name: "2G (EDGE)", Description: "Only 2G coverage: pages take tens of seconds.",
		Link: Link{RTT: 500 * ms, Jitter: 150 * ms, Down: 200, Up: 80, Loss: 2},
	},
	{
		ID: "gprs", Name: "GPRS", Description: "The slowest mobile data still around.",
		Link: Link{RTT: 800 * ms, Jitter: 200 * ms, Down: 50, Up: 25, Loss: 3},
	},
	{
		ID: "wifi-public", Name: "Busy public Wi-Fi", Description: "A café or airport hotspot shared by many people: uneven latency, losses in bursts.",
		Link: Link{RTT: 120 * ms, Jitter: 80 * ms, Down: 3_000, Up: 1_000, Loss: 3, Burst: 4},
	},
	{
		ID: "crowded", Name: "Crowded venue", Description: "A stadium or concert: the cell is overloaded, almost nothing gets through.",
		Link: Link{RTT: 400 * ms, Jitter: 250 * ms, Down: 500, Up: 150, Loss: 8, Burst: 5},
	},
	{
		ID: "satellite-geo", Name: "Satellite (GEO)", Description: "A geostationary satellite link, on ships, planes and remote sites.",
		Link: Link{RTT: 650 * ms, Jitter: 40 * ms, Down: 10_000, Up: 2_000, Loss: 0.5},
	},
	{
		ID: "slow-upload", Name: "Slow upload", Description: "Fast download, a crawling upload: photo and video uploads, big request bodies.",
		Link: Link{RTT: 60 * ms, Jitter: 10 * ms, Down: 20_000, Up: 300},
	},
	{
		ID: "lossy", Name: "Lossy link", Description: "Plenty of bandwidth but every tenth packet lost: the worst case for TCP.",
		Link: Link{RTT: 60 * ms, Jitter: 10 * ms, Down: 10_000, Up: 5_000, Loss: 10},
	},
	{
		ID: "far-server", Name: "Far away server", Description: "Only distance: the server is on the other side of the planet.",
		Link: Link{RTT: 300 * ms, Jitter: 10 * ms},
	},
	{
		ID: leo, Name: "Satellite (Starlink)", Description: "Low orbit satellites: fast, with a short dropout every 15 seconds when the dish switches satellites.",
		Link:  Link{RTT: 45 * ms, Jitter: 15 * ms, Down: 100_000, Up: 15_000, Loss: 0.5},
		Steps: []Step{{leo, 14 * s, 15 * s}, {outage, 500 * ms, 1500 * ms}},
	},
	{
		ID: "subway", Name: "Subway", Description: "4G in stations, 3G between them, and tunnels with no signal for 5–20 seconds every minute or so.",
		Steps: []Step{{lte, 20 * s, 40 * s}, {hspa, 10 * s, 20 * s}, {outage, 5 * s, 20 * s}},
	},
	{
		ID: "commute", Name: "Driving", Description: "Handovers between cells on the road: mostly 4G, weak patches, 3G and short gaps of a few seconds.",
		Steps: []Step{{lte, 40 * s, 80 * s}, {lteBad, 15 * s, 30 * s}, {hspa, 10 * s, 20 * s}, {outage, 2 * s, 6 * s}},
	},
	{
		ID: "elevator", Name: "Elevator", Description: "Typical 4G, then 8–15 seconds with no signal about every minute.",
		Steps: []Step{{lte, 45 * s, 75 * s}, {outage, 8 * s, 15 * s}},
	},
	{
		ID: "fading", Name: "Fading signal", Description: "Walking away from the cell: 4G, weak 4G, 3G, 2G and nothing, 20 seconds each, then back again.",
		Steps: []Step{{lte, 20 * s, 20 * s}, {lteBad, 20 * s, 20 * s}, {hspa, 20 * s, 20 * s}, {edge, 20 * s, 20 * s}, {outage, 20 * s, 20 * s}},
	},
	{
		ID: "flapping", Name: "Flapping", Description: "Typical 4G that drops for 3 seconds every 3 seconds: retries and reconnects.",
		Steps: []Step{{lte, 3 * s, 3 * s}, {outage, 3 * s, 3 * s}},
	},
}

func Find(id contract.NetworkProfile) (Profile, bool) {
	for _, p := range Profiles {
		if p.ID == id {
			return p, true
		}
	}
	return Profile{}, false
}

// Catalog is what DeviceState offers.
func Catalog() []contract.NetworkProfileInfo {
	out := make([]contract.NetworkProfileInfo, 0, len(Profiles))
	for _, p := range Profiles {
		l := p.Link
		out = append(out, contract.NetworkProfileInfo{
			ID:          p.ID,
			Name:        p.Name,
			Description: p.Description,
			Scenario:    len(p.Steps) > 0,
			RTT:         int(l.RTT.Milliseconds()),
			Jitter:      int(l.Jitter.Milliseconds()),
			Down:        l.Down,
			Up:          l.Up,
			Loss:        l.Loss,
		})
	}
	return out
}
