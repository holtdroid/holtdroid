---
title: Emulator provider
description: Run sessions as redroid Pods (Android on the node's kernel) on Kubernetes, several per node.
sidebar:
  order: 6
---

The `provider-emulator` service runs every session as a Pod with
[redroid](https://github.com/remote-android/redroid-doc), Android 15 in a
container on the node's own kernel, so several sessions share a node. It
creates the Pods in its own namespace and needs a ServiceAccount allowed to
manage Pods and Secrets there, to create and update its maintenance
ConfigMap, and to list Nodes cluster-wide (the Helm chart creates all of it).

```yaml
listen: ":8080"
kubeconfig: "" # empty: the Pod's service account
namespace: holtdroid
slots: 0 # cap over all nodes; 0: no cap
slotsPerNode: 1
nodeSelector: "holtdroid/sessions=true" # a label selector
tolerations:
  - { key: dedicated, operator: Equal, value: nas, effect: NoSchedule }
image: ghcr.io/holtdroid/holtdroid-session:0.1.0 # the agent
imagePullPolicy: IfNotPresent
imagePullSecrets: []
agentPort: 8080
redroid:
  images: # Android version → image; the newest is the default
    "15": ghcr.io/holtdroid/holtdroid-redroid:15
  screens: [] # the built-in presets; see below
  fps: 60
  gpu: /dev/dri/renderD128
  dataSize: 8Gi
  shell: allowlist # what users' ADB may run inside Android: allowlist | full | off
  args: [] # more redroid boot arguments
resources: # the Android container
  requests: { cpu: 500m, memory: 1536Mi }
  limits: { memory: 3Gi }
agentResources:
  requests: { cpu: 100m, memory: 256Mi }
  limits: { memory: 1Gi }
nodes:
  big-node: # a node name
    slots: 6
    resources: # replaces resources above on this node
      requests: { cpu: "1", memory: 2Gi }
      limits: { memory: 4Gi }
vpn:
  locations: [] # see below; empty means no VPN sidecar
maintenance: holtdroid-emulator-maintenance # ConfigMap for maintenance holds; empty turns them off
nodeInfo:
  selector: "app.kubernetes.io/component=node-info" # node-info Pods in the namespace; empty: none
  port: 8090
```

| Key                        | Meaning                                                                                                                                                                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kubeconfig`               | Path to a kubeconfig. Empty uses the in-cluster service account                                                                                                                                                                                                                                     |
| `namespace`                | Where session Pods and their Secrets are created                                                                                                                                                                                                                                                    |
| `nodeSelector`             | [Label selector](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/#label-selectors) for nodes that may run sessions. See [Node requirements](#node-requirements)                                                                                                            |
| `tolerations`              | Taints session Pods tolerate. Nodes with other `NoSchedule`/`NoExecute` taints are not used                                                                                                                                                                                                         |
| `slots`                    | Maximum concurrent sessions over all nodes; `0` means no cap                                                                                                                                                                                                                                        |
| `fillOrder`                | Node names, one per slot, in the order free slots are handed out: the nth occurrence of a node is its slot n. `[core, core, k3s-1, k3s-2, k3s-3, core, core, core, core]` fills two slots on `core`, then one on each k3s node, then the rest of `core`. Slots beyond the list follow, by node name |
| `slotsPerNode`             | Sessions per node, unless `nodes.<name>.slots` says otherwise                                                                                                                                                                                                                                       |
| `image`, `imagePullPolicy` | Session image: the agent with adb, Frida and scrcpy-server. The pull policy applies to the redroid image too                                                                                                                                                                                        |
| `imagePullSecrets`         | Secret names for pulling the images                                                                                                                                                                                                                                                                 |
| `agentPort`                | Port the agent listens on inside the Pod; the api reaches it at the Pod IP                                                                                                                                                                                                                          |
| `redroid.images`           | Android version → image, [holtdroid-redroid](https://github.com/holtdroid/holtdroid-redroid) tagged by version: redroid with software video encoders and ARM64 translation. The launch dialog offers the versions; the newest is the default                                                        |
| `redroid.screens`          | Screens the launch dialog offers (`id`, `label`, `like`, `width`, `height`, `dpi`, `cutout`); the first is the default. Empty takes the built-in presets, see [Screens](#screens-and-android-versions)                                                                                              |
| `redroid.fps`              | Refresh rate, fixed at boot                                                                                                                                                                                                                                                                         |
| `redroid.shell`            | What users' ADB may run inside Android: `allowlist` (default), `full` or `off`, see [Users' ADB](#users-adb-inside-android)                                                                                                                                                                         |
| `redroid.gpu`              | DRI render node Android renders on                                                                                                                                                                                                                                                                  |
| `redroid.dataSize`         | Size limit of the `emptyDir` holding Android's `/data`                                                                                                                                                                                                                                              |
| `resources`                | Android container resources. Leave out a CPU limit: a busy session may borrow idle cores                                                                                                                                                                                                            |
| `agentResources`           | Agent container resources                                                                                                                                                                                                                                                                           |
| `nodes`                    | Per-node overrides by node name: `slots` and `resources`                                                                                                                                                                                                                                            |
| `vpn`                      | Per-session VPN, see below                                                                                                                                                                                                                                                                          |
| `sessionTelemetry`         | Metrics port and tracing settings passed to session agents, see [Monitoring](/holtdroid/operations/monitoring/)                                                                                                                                                                                     |
| `maintenance`              | Name of the ConfigMap in `namespace` that keeps maintenance holds. The provider creates it on the first hold. Empty turns holds off                                                                                                                                                                 |
| `nodeInfo`                 | Label `selector` and `port` of the `holtdroid node-info` Pods that describe session nodes on the Inventory page. Empty selector: Node objects only                                                                                                                                                  |

Every matching node has `slotsPerNode` slots, named `<node>-1`, `<node>-2`,
…. A session takes the first free slot, or the one picked in the launch
dialog, and its Pod is pinned to that slot's node; slots of nodes that are
not Ready or are cordoned show as offline. Session state lives on the Pod,
so restarting the provider loses nothing. Run one provider replica per
namespace.

## Sizing

An idle session takes about 1 GB of memory and 0.05 of a core. Streaming a
screen that keeps changing costs about one core per 720p stream (video is
encoded in software inside Android), and WebGL in all sessions of a node
shares its GPU evenly. Measured on a Ryzen 7 5825U with Radeon graphics: six
sessions run side by side. Count on 1 core and 1.5 GB per slot, plus room for
whatever else the node runs.

## Node requirements

- Linux with binder (`CONFIG_ANDROID_BINDERFS`); ashmem is not needed.
- A GPU with a Mesa driver and a render node (`/dev/dri/renderD128`): Intel
  and AMD integrated graphics work. WebGL runs on it; WebGPU is not
  available in WebView.
- For [network conditions](#network-conditions): the `sch_netem`, `sch_htb`, `ifb`, `cls_u32`,
  `act_mirred` and `cls_matchall` kernel modules (stock distribution kernels
  have them; they load on first use).
- containerd and Kubernetes that support
  `securityContext.supplementalGroupsPolicy` (1.31 or newer); the pre-pull
  DaemonSet also uses an image volume (1.35, or the `ImageVolume` feature
  gate).
- **Nodes dedicated to sessions.** The Android container is privileged and
  shares the node's kernel, so root inside a session — frida-server, the
  agent's adb, and users' ADB with `redroid.shell: full` — is root on the
  node. Keep session nodes free of anything else (taint them and set
  `nodeSelector`/`tolerations`). The provider keeps the rest of the cluster
  out of Android's reach: the chart's egress NetworkPolicy lets sessions
  reach only cluster DNS, the api and the internet (the LAN, node IPs and
  other Pods are carved out), the agent container runs without privileges
  (only `NET_ADMIN` in the Pod's network namespace, for network conditions),
  users' ADB runs only allowlisted commands by default, and the image's init
  wrapper keeps Android from rewriting the node's sysctls. See
  [Security](/holtdroid/operations/security/).

Apps with only `arm64-v8a` native code run through `libndk_translation`;
separate ARM executables don't (that would need `binfmt_misc` on the node).

## Pod layout

Each session Pod has three containers sharing one network namespace:

- `android`: the redroid image of the launch's Android version, privileged,
  as root, with an `emptyDir` on `/data`. Its boot arguments set the GPU and
  the launch's screen.
- `agent`: the session image, without privileges (all capabilities dropped,
  except `NET_ADMIN` when VPN locations are configured: it shapes the VPN
  tunnel for [network conditions](#network-conditions)).
  It reaches Android's adbd at `127.0.0.1:5555` and frida-server at
  `127.0.0.1:27042`, roots adbd, enables the screen's cutout overlay,
  installs and instruments the app and serves the Agent API. The node's
  `/sys/fs/cgroup` is mounted read-only at `/host/cgroup` so the device card
  shows the `android` container's CPU and memory (its limits, or the node's
  without them), and `/data` against `redroid.dataSize` rather than the
  node's disk.
- `vpn`: the sing-box sidecar, when locations are configured.

adbd listens on every address of the Pod; keep `networkPolicy` on so only
the api and the ssh-gateway reach the Pod, and its `egress` rules on so
Android reaches only cluster DNS, the api and the internet. Anything
in-cluster a sidecar needs, such as a shared VPN gateway, goes into
`networkPolicy.egress.extraEgress`.

## Screens and Android versions

The launch dialog offers the provider's screens and Android versions
(`Screen` and `Android` selects, remembered per provider). Versions older
than the build's `minSdk` or `requiresSdk` tag are greyed out with the
reason in a tooltip, and the newest one it runs on is picked instead. Quick
launch does the same: it keeps the Android version used last when the build
runs on it, otherwise takes the newest one that fits, and shows the version
in its tooltip; when no version fits, the button is disabled and says why. A screen is fixed
for the session: width, height and density in pixels, as a popular phone
reports them, plus an emulated display cutout. Android ships overlays for
cutouts — `corner` (a hole in the top-left corner), `double` (notches top
and bottom), `hole` (a centered punch hole), `tall` (a tall notch) and
`waterfall` (curved edges) — which the agent enables after boot with
`cmd overlay`, so apps see `WindowInsets` with a real cutout. Android doesn't
draw the black shape in the stream, so the session page paints it over the
screen (with a speaker and camera) together with the display's rounded
corners; the cutout fades to 30% under the pointer and passes clicks through
to the device.

In the launch dialog five screens show as cards and "More devices" opens a
searchable list of all of them; a star marks a favorite (kept in your
browser), and favorites come first in both places. Besides the generic
screens below, the provider ships a catalog of about fifty
real phones and tablets (Pixel, Galaxy A and S, Redmi, Poco, Moto, OnePlus,
Realme, Fairphone and others), searchable in the launch dialog. Each has its
size, density, corner radius and a cutout shape: a punch hole, a capsule, a
waterdrop or a wide notch, placed in dp from the top edge. The numbers
are approximations from public specifications and measurements, good enough
to see how an app's header sits next to a cutout, not to the pixel. A screen
in `redroid.screens` takes the same fields: `brand`, `radius` (dp) and
`shape` (`kind` `circle`, `pill`, `drop` or `notch`, `align`, `offset`, `top`,
`width`, `height`); the Android overlay is derived from the shape unless
`cutout` names one. The built-in
presets, used when `redroid.screens` is empty:

| id            | Screen                           | Density | Cutout | Like                              |
| ------------- | -------------------------------- | ------- | ------ | --------------------------------- |
| `hd`          | 720×1600 (6.7″ HD+, the default) | 280     | `tall` | Galaxy A05, Redmi 13C             |
| `fhd-samsung` | 1080×2340 (6.5″ FHD+)            | 420     | `tall` | Galaxy A15, A25, A35              |
| `fhd`         | 1080×2400 (6.1–6.7″ FHD+)        | 420     | `hole` | Pixel 6a–8a, Moto G54, Realme C67 |
| `fhd-tall`    | 1080×2460 (6.8″ FHD+)            | 420     | `hole` | Infinix Hot 40                    |
| `1.5k`        | 1220×2712 (6.7″ 1.5K)            | 480     | `hole` | Redmi Note 13 Pro, Poco X6        |
| `classic`     | 1080×1920 (360×640 CSS px)       | 480     | none   | Galaxy S5, Nexus 5X, Moto G4      |
| `compact`     | 720×1440 (360×720 CSS px)        | 320     | none   | Redmi 6A, Galaxy J4+              |
| `flat`        | 1080×2400 (6.5″)                 | 420     | none   | Under-display camera, sliders     |
| `tablet`      | 1200×1920 (11″)                  | 240     | none   | Galaxy Tab A9+                    |

Streaming a bigger screen costs more CPU in the session (about one core for
a changing 1080p screen) and bandwidth in the browser; the default stays
HD+. Density can still be changed in a session's display card.

Android versions are the keys of `redroid.images` (the chart: `versions`,
each pulled from `<repository>:<version>`). holtdroid-redroid publishes one
tag per Android major version it supports (11 to 15). Android 16 boots
but its netd aborts on a mainline kernel (Android's BPF loader accepts only
LTS kernels), so it is not offered. The Android 13 and 14 images have no
Bluetooth: redroid's simulated Bluetooth controller crashes there as soon
as Android enables it, so the images drop the feature and apps see a device
without Bluetooth. Android 11, 12 and 15 keep a simulated one.

Every image runs 32-bit x86 apps next to 64-bit ones (`zygote64_32`).
Google Chrome's x86 builds run their browser in 32 bits and keep only
WebView in the 64-bit library, so on a 64-bit-only Android they abort at
startup with "WebView cannot be started with a browser process type". ARM
translation is 64-bit only: the Android 12 to 15 images list `arm64-v8a`
but not `armeabi-v7a`, so an app whose native libraries are only 32-bit ARM
doesn't install there (Android 11 lists it and the app crashes instead).

With a WebView catalog (`webview.storage`), the launch dialog also offers a
WebView build for the chosen Android version, which the agent installs over
the built-in one. This needs holtdroid-redroid images that re-sign the
built-in WebView with Chromium's debug key, which every published tag does.
See [WebView versions](/holtdroid/concepts/webview-versions/).

## Users' ADB inside Android

Android in redroid is a userdebug build whose adbd runs as root on the
node's kernel. `redroid.shell` says what users' ADB — the browser tabs and
the `holtdroid` client — may run there:

- `allowlist` (default): only the read-only commands and package operations
  behind the Logcat and Files tabs and the app and device cards (`getprop`, `logcat`, `pm`,
  `am`, `cmd package`, `settings get`, a few `dumpsys`), plus file transfer
  and port forwards. The Terminal tab is not shown.
- `full`: any command, and the Terminal tab appears. Only for clusters whose
  session nodes run nothing else and whose users are trusted with them.
- `off`: no shell commands at all; file transfer and forwards still work.

The agent's own adb is not affected. Requests that would cut the agent off
(`reboot`, `unroot`, `remount`, `tcpip`, `usb`, `sideload`, verity) are
always refused.

### Device controls

Without an emulator console, the GPS goes through Android's test location
providers (on Android 11, whose `cmd location` has no providers command,
through a small `app_process` helper) and the battery through `dumpsys
battery`. The brightness slider shows the same percentage as the device's
own shade, which is on Android's gamma curve rather than linear.

Android in a session has a real Wi-Fi when its node loads
`mac80211_hwsim` with `radios=0` (`options mac80211_hwsim radios=0` in
the node's modprobe configuration, and the module in its boot modules).
The holtdroid-redroid image then creates two simulated radios in the
session's own network namespace: Android joins the open network
`HoltdroidWifi`, whose access point and DHCP run in a private namespace
of the session, and the status bar, quick settings and the Wi-Fi tile
behave as on a phone. Sessions can't see or join each other's radios, and
the radios disappear with the session. The Wi-Fi toggle in the portal and
the tile in Android's shade are the same switch.

redroid has no modem. Mobile data is a second uplink that Android takes
for Ethernet and the app under test sees as mobile data (the Frida script
relabels it); it carries traffic only while Wi-Fi is off, as a phone
prefers Wi-Fi, so with Wi-Fi off and mobile data on the status bar shows
Ethernet.

Without the module the Wi-Fi and mobile data toggles are the session's
own: a session starts with both on, the app under test sees Android's
Ethernet as the radio that is on, and with both off or in airplane mode it
sees no network and only root keeps a route. Android's own status bar and
quick settings show Ethernet then.

The module is a kernel test driver: anything on the node with
`CAP_NET_ADMIN` can create radios in its own network namespace. Load it on
the nodes that run sessions.

Android in redroid runs on the node's kernel and its clock is the node's: a
session can change its time zone but not its time, and the date and time
card says so.

Android 12 doesn't get the `corner`, `hole` and `tall` cutouts emulated:
they crash its SystemUI. The portal still draws them on the phone frame.

redroid builds Android with the lock screen off. Locking the screen from
the power key turns it on: an overlay on Android 12 and later (swipe up to
unlock), a temporary PIN `0000` on Android 11, which **Wake and unlock**
enters and removes. Since the overlay is turned on at boot, Android 12 and
later boot onto the lock screen; the agent wakes and unlocks the device
before it starts the app, so a session opens unlocked.

## Inventory and maintenance

Admins see every slot on the **Inventory** page with its node: its OS image,
kernel, kubelet and container runtime, CPU and memory from the Node object,
the conditions it reports (`NotReady`, `DiskPressure`, …) and the session on
it. With `nodeInfo` set, a small `holtdroid node-info` Pod on each node adds
the CPU model, load, free memory, uptime and every temperature sensor the
node exposes (thermal zones and hwmon: CPU package and cores, NVMe drives,
chipsets). It reads `/proc` and `/sys`, which are host-wide inside an
ordinary container, so it runs unprivileged as non-root. Each slot's row
also shows the session on it (owner, age, idle time, when it stops on its
own, VPN location, WebView), and the page's **Sessions** tab lists
everyone's devices with a **Stop** button.

**Hold for maintenance** keeps new sessions off a slot (or, from the
provider's header, off every slot) until an admin releases it; a session
running there keeps going. Holds live in the `maintenance` ConfigMap, so a
restart keeps them. Cordoning the node in Kubernetes still works too: it
shows as offline.

## Helm chart

`providers.emulator.enabled: true` deploys the provider (one replica) with its
ServiceAccount, a Role for Pods and Secrets in the release namespace and a
ClusterRole to list Nodes. The chart fills `namespace`, `image` and
`imagePullSecrets` itself:

```yaml
providers:
  emulator:
    enabled: true
    slots: 0
    slotsPerNode: 1
    nodeSelector: { holtdroid/sessions: "true" } # a map here; the chart turns it into a selector
    tolerations: []
    session: # the agent
      image: { repository: ghcr.io/holtdroid/holtdroid-session, tag: "" } # tag defaults to image.tag
      resources: { requests: { cpu: 100m, memory: 256Mi }, limits: { memory: 1Gi } }
    redroid:
      image: { repository: ghcr.io/holtdroid/holtdroid-redroid }
      versions: ["15"] # tags of the repository, offered at launch
      screens: [] # the built-in presets
      fps: 60
      gpu: /dev/dri/renderD128
      dataSize: 8Gi
      shell: allowlist
      resources: { requests: { cpu: 500m, memory: 1536Mi }, limits: { memory: 3Gi } }
    nodes: {} # per-node overrides, as above
    vpn: {} # the vpn section below
    networkPolicy:
      enabled: true # only the api and the provider reach session agents
      egress:
        enabled: true # Android reaches only cluster DNS, the api and the internet
        privateRanges: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, 169.254.0.0/16]
        extraEgress: [] # e.g. the VPN gateway's Pods: [{ to: [{ namespaceSelector: {...}, podSelector: {...} }], ports: [{ protocol: TCP, port: 1080 }] }]
    prepull:
      enabled: true # DaemonSet that pulls the session and redroid images onto session nodes
      refresh: { enabled: true, interval: 5m }
    nodeInfo:
      enabled: true # DaemonSet of holtdroid node-info for the Inventory page
```

The chart names the maintenance ConfigMap
`<release>-provider-emulator-maintenance` and lets the provider's Role create
it and update only that one. The node-info DaemonSet runs on the same nodes
as sessions (`nodeSelector`, `tolerations`) and, with `networkPolicy` on, only
the provider may reach it.

The redroid image is about 1.5 GB. The pre-pull DaemonSet runs on the same
nodes as sessions and keeps the current tags of both images on disk (the
redroid one as an image volume), so the first launch after an upgrade
doesn't wait for the download.

With a moving tag (`tag: main`) and `pullPolicy: Always`, an upgrade of the
image doesn't change the chart, so the DaemonSet wouldn't notice it. With
`prepull.refresh` on (the default), the provider asks the registry for the
tags' digests every `interval` and, when one moves, restarts the DaemonSet:
the nodes pull the new layers in the background, before the next session
needs them. The registry is queried anonymously, which works for public
images; with a pinned tag or `IfNotPresent` the refresh does nothing.

## VPN

With at least one location, every session Pod gets a `vpn` sidecar (see
[Per-session VPN](/holtdroid/concepts/vpn/)). Each location is a sing-box
outbound; the usual one points at a
[shared VPN gateway](/holtdroid/operations/vpn-gateway/):

```yaml
vpn:
  image: ghcr.io/sagernet/sing-box:v1.14.2
  bypassCIDRs: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7]
  dns: 1.1.1.1
  resolver: 10.43.0.10 # cluster DNS; needed for *.cluster.local names
  direct: true
  default: direct
  locations:
    - id: de
      label: Germany
      outbound:
        type: socks
        server: vpn-gateway.vpn.svc.cluster.local
        server_port: 1080
        username: de
        password: env:VPN_GATEWAY_PASSWORD # any string field may be a secret reference
        udp_over_tcp: true
    - id: nl
      label: Netherlands
      defaultFor: [com.example.app] # this app starts here instead of vpn.default
      outbound: openbao:secret/holtdroid#vpn_nl # the outbound as JSON
```

| Key               | Meaning                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vpn.image`       | sing-box image for the sidecar (1.12 or newer)                                                                                                                                                                                                                                                                            |
| `vpn.bypassCIDRs` | Ranges that never go through the tunnel. Must include your Pod and Service CIDRs, and the gateway's address                                                                                                                                                                                                               |
| `vpn.dns`         | Resolver (IP) for the device's DNS, queried through the selected location                                                                                                                                                                                                                                                 |
| `vpn.resolver`    | Resolver (IP) for host names inside outbounds. Empty uses the Pod's `/etc/resolv.conf`, but sing-box sends `*.local` names to mDNS, so set your cluster DNS here when outbounds use `*.cluster.local`                                                                                                                     |
| `vpn.direct`      | Offer a `direct` location (no VPN). Default `true`; set `false` so every session always goes out through a VPN location. Apps then have no network at all while the tunnel is down, instead of falling back to the Pod's own address                                                                                      |
| `vpn.default`     | Location a session starts in when the user picks none. Default: `direct`, or the first location                                                                                                                                                                                                                           |
| `vpn.locations`   | `id` (lowercase letters, digits, `-`; quote ids YAML reads as booleans, such as `"no"` for Norway), `label`, `outbound`, and optionally `defaultFor`                                                                                                                                                                      |
| `…[].defaultFor`  | Package names whose sessions start in this location instead of `vpn.default`, e.g. `[com.example.app]`. A package may be listed under one location only                                                                                                                                                                   |
| `…[].outbound`    | A sing-box outbound or endpoint object without `tag`, or a [secret reference](/holtdroid/configuration/secrets/) whose value is that object as JSON. Inside an object, any string value that is a secret reference (`env:`, `file:`, `openbao:`) is replaced by the secret, at any depth: use that for passwords and keys |

Any outbound works, for example a WireGuard endpoint straight in the sidecar
(set `mtu: 1280` on overlay networks such as flannel VXLAN). But a WireGuard
key used by several session Pods at once breaks, so prefer the gateway.

## Network conditions

With VPN locations configured, a session's **Network** tab (next to
DevTools) offers emulated network conditions; the network card next to the
phone shows which are on and links there. The access link is one of the named networks (5G, typical and weak 4G, 3G,
2G, GPRS, busy public Wi-Fi, a crowded venue, satellite links, a slow
upload, a lossy link, a far away server) and scenarios that change them over
time (subway, driving, elevator, a fading signal, a flapping link, Starlink's
satellite switches). Each shows its latency, bandwidth and loss next to a
short description. The numbers are rough medians of public mobile network
reports, not measurements of a specific operator.

### Regions

On top of the access link, a **region** stands in for the app's users in a
country (Germany, the United States, Ukraine, Kazakhstan, Bangladesh, India,
Pakistan, Indonesia, the Philippines, Nigeria, Kenya, Egypt, Brazil) and
splits traffic into two paths:

- **CDN edge and DNS**: the published address ranges of Cloudflare, Fastly
  and Google, and DNS, get the round trip from the region's operators to the
  CDN edge that serves them (in Bangladesh: Dhaka or Singapore, by operator).
- **Servers**: everything else, and the hosts listed as **backends behind a
  CDN** (such as an API on Cloudflare, whose requests go through to the
  servers), gets the round trip from the region to the chosen server
  location (Frankfurt, N. Virginia, N. California, São Paulo, Mumbai,
  Singapore, Tokyo).

With the access link left at no limits, the region's typical mobile link is
used. The numbers are rounded estimates from public speed reports and
latency maps, plausible rather than measured per operator.

Emulation can only add delay, and the session's own route through its VPN
location already takes some. Only the rest of each path is added; the tab
shows the region's round trip, the session's route and what is added. When
the route is already slower than the region (a VPN location far from the
servers), it says so: a closer location, or none, gets nearer.
Backends are host names, `*.example.com` for every name below it, or IPv4
addresses. The agent answers the device's DNS, so it takes the addresses
the device gets when it looks a backend up, and shapes them about a second
later; exact names are also resolved up front. The tab lists the addresses
found so far. The list is saved per user and app, in the database when it
is [persistent](/holtdroid/configuration/database/) (`sqlite`) and in the
browser otherwise, and filled in when a region is picked in the app's next
session. A CDN often puts many of its
customers' hosts on the same addresses, and those take the servers' path
too once one of them is a backend.

### The session's route

Every emulated network comes on top of the session's own route through its
VPN location, so the agent measures that route all the time, through the
VPN sidecar (the shaping doesn't touch it): the round trip to Cloudflare's
nearest edge (`https://1.1.1.1/cdn-cgi/trace`) and to each server location
(AWS's regional DynamoDB endpoints), the quickest of three requests on a
kept-alive connection, from the moment the agent starts (while Android
still boots) and every minute; then the bandwidth, a 10 MB download from
`speed.cloudflare.com` cut off after 10 seconds, after each location change
and whenever the last test is over six hours old. Every 5 minutes the api
keeps the route of each ready session per VPN location, and a new session
starts from the last one measured through its location: the tab shows it
right away (with its age), a region subtracts it from the first second, and
a bandwidth test younger than six hours isn't repeated. The Network tab
shows the route at the top, and marks what it spoils:

- a network whose own round trip is shorter than the route's (5G or good
  4G behind a far VPN location): the route already takes longer than the
  network would, so the delay ends up larger than named. Each network also
  shows the expected round trip to a CDN edge.
- a network or a region's typical link faster than the route's bandwidth:
  it is capped at about the route's rate.
- a region or a server location the route is slower to than the region's
  users are (`VPN slower: CDN, servers, bandwidth`).

They can still be picked: loss, jitter and the slower links are unaffected.

### How it works

The agent applies them with `tc` on the VPN tunnel: the tunnel's egress
(what apps send) gets the upload half, its ingress is redirected to an
`ifb` device for the download half. An `htb` class per direction holds the
link's bandwidth, and `netem` classes under it add half of each path's
round trip, jitter and loss; `u32` filters pick the path by address.
sing-box's own NAT traffic inside the tunnel's network is left alone, so
TCP is shaped once per direction.
Losses are random or in bursts (a Gilbert model). An outage drops every
packet while Android still sees a connected network, so requests hang until
they time out, the way a dead cell behaves; turn on airplane mode or switch
Wi-Fi and mobile data off for a disconnected network instead.

Only apps' traffic is shaped: the screen, DevTools, ADB, the agent and
destinations in `vpn.bypassCIDRs` are not. Without VPN locations there is no
tunnel and no network conditions.
