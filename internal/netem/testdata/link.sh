set -e
tc qdisc del dev holtdroid0 root 2>/dev/null || true
tc qdisc del dev holtdroid0 ingress 2>/dev/null || true
tc qdisc del dev holtdroid0in root 2>/dev/null || true
ip link show holtdroid0in >/dev/null 2>&1 || ip link add holtdroid0in type ifb
ip link set holtdroid0in up
tc -batch - <<'EOF'
qdisc add dev holtdroid0 root handle 1: htb default 20
class add dev holtdroid0 parent 1: classid 1:1 htb rate 80kbit
class add dev holtdroid0 parent 1:1 classid 1:20 htb rate 8kbit ceil 80kbit quantum 1514
qdisc add dev holtdroid0 parent 1:20 handle 20: netem delay 250ms 75ms limit 20 loss random 2%
class add dev holtdroid0 parent 1: classid 1:30 htb rate 10gbit quantum 1514
filter add dev holtdroid0 parent 1: protocol ip prio 1 u32 match ip dst 198.18.0.0/30 flowid 1:30
qdisc add dev holtdroid0in root handle 1: htb default 20
class add dev holtdroid0in parent 1: classid 1:1 htb rate 200kbit
class add dev holtdroid0in parent 1:1 classid 1:20 htb rate 8kbit ceil 200kbit quantum 1514
qdisc add dev holtdroid0in parent 1:20 handle 20: netem delay 250ms 75ms limit 20 loss random 2%
qdisc add dev holtdroid0 handle ffff: ingress
filter add dev holtdroid0 parent ffff: protocol ip prio 1 u32 match ip src 198.18.0.0/30 action ok
filter add dev holtdroid0 parent ffff: prio 2 matchall action mirred egress redirect dev holtdroid0in
EOF
