package sshgateway

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	connectionsGauge = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "holtdroid_ssh_connections",
		Help: "Open SSH connections.",
	})
	loginsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "holtdroid_ssh_logins_total",
		Help: "SSH logins by result.",
	}, []string{"result"})
	tunnelsGauge = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "holtdroid_ssh_tunnels",
		Help: "Open tunnels by kind: adb (-L) or reverse (-R).",
	}, []string{"kind"})
	tunnelsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "holtdroid_ssh_tunnels_total",
		Help: "Tunnel requests by kind and result.",
	}, []string{"kind", "result"})
	keyRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "holtdroid_ssh_key_requests_total",
		Help: "Links offered to add an unknown key, by outcome: created, added or expired.",
	}, []string{"result"})
	bytesTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "holtdroid_ssh_bytes_total",
		Help: "Bytes carried through SSH tunnels in both directions.",
	})
)
