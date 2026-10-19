import Java from "frida-java-bridge"

// A rooted session reaches the internet through the VpnService tunnel, which
// Android registers with the VPN transport — apps can see that and some refuse
// a VPN. relabelVpn() rewrites the active network's transport from VPN to
// Wi-Fi for the app under test, so it sees an ordinary Wi-Fi connection while
// the real VPN network keeps carrying its data and DNS.
//
// A kernel-route tunnel (the experimental transparent path) instead registers
// no network at all, so getActiveNetwork() returns null and some apps crash in
// a network callback; fillWhenOffline() presents a synthetic validated Wi-Fi
// network whenever the system genuinely has none. Every hook calls through to
// the real method first, so both are a no-op on the emulator and on a phone
// with an ordinary network.

const TYPE_WIFI = 1
const TYPE_VPN = 17
const TRANSPORT_WIFI = 1
const TRANSPORT_VPN = 4
const NET_CAPABILITY_NOT_VPN = 15
const WIFI_STATE_ENABLED = 3

const CAPABILITIES = [
  11, // NOT_METERED
  12, // INTERNET
  13, // NOT_RESTRICTED
  14, // TRUSTED
  15, // NOT_VPN
  16, // VALIDATED
  21, // NOT_SUSPENDED
]

function tryHook(label: string, fn: () => void) {
  try {
    fn()
  } catch (e) {
    console.warn(`connectivity ${label}: ${e}`)
  }
}

function fabricate() {
  const network = Java.use("android.net.Network").$new(100)

  const info = Java.use("android.net.NetworkInfo").$new(TYPE_WIFI, 0, "WIFI", "")
  info.setDetailedState(Java.use("android.net.NetworkInfo$DetailedState").CONNECTED.value, null, null)
  tryHook("setIsAvailable", () => info.setIsAvailable(true))

  const caps = Java.use("android.net.NetworkCapabilities").$new()
  caps.addTransportType(TRANSPORT_WIFI)
  for (const c of CAPABILITIES) tryHook(`addCapability ${c}`, () => caps.addCapability(c))

  return { network, info, caps }
}

// offline is true only when the system has no network agent at all; disconnected
// radios register none. getAllNetworks is not hooked, so this sees the truth.
function offline(cm: Java.Wrapper): boolean {
  try {
    return cm.getAllNetworks().length === 0
  } catch {
    return false
  }
}

// relabelVpn rewrites a VPN-transport network as Wi-Fi: the active network
// keeps carrying data and DNS, but the app under test sees Wi-Fi instead of a
// VPN. It flips the transport and the NOT_VPN capability on any VPN
// NetworkCapabilities, and the type on any VPN NetworkInfo, so every path the
// app inspects (getActiveNetworkInfo, getNetworkCapabilities, network
// callbacks) agrees. Non-VPN networks pass through untouched.
function relabelVpn() {
  const NC = Java.use("android.net.NetworkCapabilities")
  tryHook("hasTransport", () => {
    NC.hasTransport.implementation = function (t: number) {
      if (!this.hasTransport(TRANSPORT_VPN)) return this.hasTransport(t)
      if (t === TRANSPORT_VPN) return false
      if (t === TRANSPORT_WIFI) return true
      return this.hasTransport(t)
    }
  })
  tryHook("hasCapability", () => {
    NC.hasCapability.implementation = function (c: number) {
      const real = this.hasCapability(c)
      return c === NET_CAPABILITY_NOT_VPN && !real ? true : real
    }
  })
  const NI = Java.use("android.net.NetworkInfo")
  tryHook("getType", () => {
    NI.getType.implementation = function () {
      const t = this.getType()
      return t === TYPE_VPN ? TYPE_WIFI : t
    }
  })
  tryHook("getTypeName", () => {
    NI.getTypeName.implementation = function () {
      const n = this.getTypeName()
      return n === "VPN" ? "WIFI" : n
    }
  })
}

// spoofWifi makes the app see a connected Wi-Fi: some apps (anti-VPN betting
// apps among them) check WifiManager directly and refuse, or pick fallback
// domains, when Wi-Fi is not connected. The farm phone has no real Wi-Fi, so
// its WifiInfo is "disconnected, ssid <unknown>, netId -1"; this reports an
// enabled, associated network instead. Fields that already hold a real value
// are left alone, so it is a no-op where Wi-Fi is genuinely connected.
function spoofWifi() {
  const WM = Java.use("android.net.wifi.WifiManager")
  tryHook("isWifiEnabled", () => {
    WM.isWifiEnabled.implementation = () => true
  })
  tryHook("getWifiState", () => {
    WM.getWifiState.implementation = () => WIFI_STATE_ENABLED
  })

  const WI = Java.use("android.net.wifi.WifiInfo")
  const completed = Java.use("android.net.wifi.SupplicantState").COMPLETED.value
  tryHook("WifiInfo.getSSID", () => {
    WI.getSSID.implementation = function () {
      const s = this.getSSID()
      return s === null || s === "<unknown ssid>" || s === "" ? '"AndroidWifi"' : s
    }
  })
  tryHook("WifiInfo.getBSSID", () => {
    WI.getBSSID.implementation = function () {
      const b = this.getBSSID()
      return b === null || b === "02:00:00:00:00:00" ? "02:1a:11:a0:b0:c0" : b
    }
  })
  tryHook("WifiInfo.getNetworkId", () => {
    WI.getNetworkId.implementation = function () {
      const n = this.getNetworkId()
      return n === -1 ? 1 : n
    }
  })
  tryHook("WifiInfo.getSupplicantState", () => {
    WI.getSupplicantState.implementation = function () {
      const s = this.getSupplicantState()
      return s !== null && s.toString() === "COMPLETED" ? s : completed
    }
  })
  tryHook("WifiInfo.getRssi", () => {
    WI.getRssi.implementation = function () {
      const r = this.getRssi()
      return r <= -127 ? -55 : r
    }
  })
  tryHook("WifiInfo.getLinkSpeed", () => {
    WI.getLinkSpeed.implementation = function () {
      const r = this.getLinkSpeed()
      return r < 0 ? 150 : r
    }
  })
  tryHook("WifiInfo.getFrequency", () => {
    WI.getFrequency.implementation = function () {
      const r = this.getFrequency()
      return r < 0 ? 2412 : r
    }
  })
}

// hideVpnInterface renames the tunnel interface (tun0/ppp/tap) to wlan0 for
// the app, so VPN detection that enumerates NetworkInterface by name does not
// see it.
function hideVpnInterface() {
  const mask = (n: string | null) => (n !== null && /^(tun|ppp|tap)/.test(n) ? "wlan0" : n)
  const NetworkInterface = Java.use("java.net.NetworkInterface")
  tryHook("NetworkInterface.getName", () => {
    NetworkInterface.getName.implementation = function () {
      return mask(this.getName())
    }
  })
  tryHook("NetworkInterface.getDisplayName", () => {
    NetworkInterface.getDisplayName.implementation = function () {
      return mask(this.getDisplayName())
    }
  })
}

export function spoofConnectivity() {
  relabelVpn()
  spoofWifi()
  hideVpnInterface()

  let fake: { network: Java.Wrapper; info: Java.Wrapper; caps: Java.Wrapper }
  try {
    fake = fabricate()
  } catch (e) {
    console.warn(`connectivity spoof unavailable: ${e}`)
    return
  }
  const { network, info, caps } = fake

  const CM = Java.use("android.net.ConnectivityManager")

  CM.getActiveNetwork.implementation = function () {
    const real = this.getActiveNetwork()
    return real !== null ? real : network
  }
  CM.getActiveNetworkInfo.implementation = function () {
    const real = this.getActiveNetworkInfo()
    return real !== null && real.isConnected() ? real : info
  }
  CM.getNetworkCapabilities.implementation = function (net: Java.Wrapper) {
    const real = this.getNetworkCapabilities(net)
    return real !== null ? real : caps
  }
  CM.isActiveNetworkMetered.implementation = function () {
    return offline(this) ? false : this.isActiveNetworkMetered()
  }
  CM.bindProcessToNetwork.implementation = function (net: Java.Wrapper) {
    // Binding the process to our fake netId would fwmark its sockets to a
    // network the kernel does not know; leave them on the default route (tun).
    return net !== null && net.equals(network) ? true : this.bindProcessToNetwork(net)
  }
  tryHook("getNetworkInfo(int)", () => {
    CM.getNetworkInfo.overload("int").implementation = function (type: number) {
      const real = this.getNetworkInfo(type)
      if (real !== null && real.isConnected()) return real
      return type === TYPE_WIFI ? info : real
    }
  })
  tryHook("getNetworkInfo(Network)", () => {
    CM.getNetworkInfo.overload("android.net.Network").implementation = function (net: Java.Wrapper) {
      const real = this.getNetworkInfo(net)
      return real !== null ? real : info
    }
  })
  tryHook("setProcessDefaultNetwork", () => {
    const orig = CM.setProcessDefaultNetwork.overload("android.net.Network")
    orig.implementation = function (net: Java.Wrapper) {
      return net !== null && net.equals(network) ? true : orig.call(this, net)
    }
  })

  hookNetwork(network)
  hookCallbacks(CM, network, caps)
}

// hookNetwork keeps calls scoped to our fake network on the default route: an
// openConnection goes out unbound, a bindSocket is a no-op.
function hookNetwork(network: Java.Wrapper) {
  const Network = Java.use("android.net.Network")
  tryHook("openConnection(URL)", () => {
    Network.openConnection.overload("java.net.URL").implementation = function (url: Java.Wrapper) {
      return this.equals(network) ? url.openConnection() : this.openConnection(url)
    }
  })
  tryHook("openConnection(URL,Proxy)", () => {
    Network.openConnection.overload("java.net.URL", "java.net.Proxy").implementation = function (
      url: Java.Wrapper,
      proxy: Java.Wrapper,
    ) {
      return this.equals(network) ? url.openConnection(proxy) : this.openConnection(url, proxy)
    }
  })
  for (const arg of ["java.net.Socket", "java.net.DatagramSocket", "java.io.FileDescriptor"]) {
    tryHook(`bindSocket(${arg})`, () => {
      Network.bindSocket.overload(arg).implementation = function (s: Java.Wrapper) {
        if (this.equals(network)) return
        this.bindSocket(s)
      }
    })
  }
}

// hookCallbacks delivers a one-shot onAvailable/onCapabilitiesChanged to a
// callback registered while the system is offline, so reactive apps that wait
// for a network before doing anything proceed.
function hookCallbacks(CM: Java.Wrapper, network: Java.Wrapper, caps: Java.Wrapper) {
  const NetworkCallback = Java.use("android.net.ConnectivityManager$NetworkCallback")
  const isCallback = (a: Java.Wrapper) => {
    try {
      return a !== null && NetworkCallback.class.isInstance(a)
    } catch {
      return false
    }
  }
  const deliver = (cb: Java.Wrapper) => {
    tryHook("onAvailable", () => cb.onAvailable.overload("android.net.Network").call(cb, network))
    tryHook("onCapabilitiesChanged", () =>
      cb.onCapabilitiesChanged
        .overload("android.net.Network", "android.net.NetworkCapabilities")
        .call(cb, network, caps),
    )
  }
  const hookRegister = (name: string) => {
    tryHook(name, () => {
      for (const ov of CM[name].overloads) {
        ov.implementation = function (...args: Java.Wrapper[]) {
          const result = ov.apply(this, args)
          if (offline(this)) {
            const cb = args.find(isCallback)
            if (cb) deliver(cb)
          }
          return result
        }
      }
    })
  }
  hookRegister("registerDefaultNetworkCallback")
  hookRegister("registerNetworkCallback")
  hookRegister("requestNetwork")
}
