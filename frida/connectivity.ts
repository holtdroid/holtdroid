import Java from "frida-java-bridge"

// The rooted transparent tunnel carries packets at the kernel level (a manual
// default route into a sing-box tun), so ConnectivityManager has no registered
// network and getActiveNetwork() returns null — apps then believe they are
// offline, and some crash in a network callback. This presents a synthetic
// validated Wi-Fi network to the app under test whenever the system genuinely
// has none, so the app proceeds while its sockets keep using the default route.
// Every hook calls through to the real method first and only substitutes when
// the device is truly offline, so it is a no-op on the emulator and on a phone
// with a real network.

const TYPE_WIFI = 1
const TRANSPORT_WIFI = 1

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

export function spoofConnectivity() {
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
