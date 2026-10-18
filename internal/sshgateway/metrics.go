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
		Help: "Open tunnels by kind: adb or reverse (published ports).",
	}, []string{"kind"})
	tunnelsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "holtdroid_ssh_tunnels_total",
		Help: "Tunnel requests by kind and result.",
	}, []string{"kind", "result"})
	bytesTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "holtdroid_ssh_bytes_total",
		Help: "Bytes carried through SSH tunnels in both directions.",
	})
)
