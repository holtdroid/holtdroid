import Java from "frida-java-bridge"
import { spoofConnectivity } from "./connectivity"

function enableDebugging() {
  try {
    Java.use("android.webkit.WebView").setWebContentsDebuggingEnabled(true)
  } catch (e) {
    console.warn(`setWebContentsDebuggingEnabled: ${e}`)
  }
}

Java.perform(() => {
  spoofConnectivity()

  const WebView = Java.use("android.webkit.WebView")
  WebView.setWebContentsDebuggingEnabled.implementation = function () {
    this.setWebContentsDebuggingEnabled(true)
  }
  for (const init of WebView.$init.overloads) {
    init.implementation = function (...args) {
      const result = init.apply(this, args)
      enableDebugging()
      return result
    }
  }

  const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
  const Policy = Java.use("android.security.NetworkSecurityPolicy")
  const cleartext = Policy.isCleartextTrafficPermitted.overload("java.lang.String")
  cleartext.implementation = function (host: string) {
    return loopback.has(host.toLowerCase()) || cleartext.call(this, host)
  }

  // A Chromium browser aborts on a CHECK when the system WebView is loaded
  // into its process, so it only gets debugging if it creates a WebView.
  const isChromiumBrowser = (app: Java.Wrapper) => {
    try {
      app.getClassLoader().loadClass("org.chromium.chrome.browser.ChromeTabbedActivity")
      return true
    } catch {
      return false
    }
  }
  const Instrumentation = Java.use("android.app.Instrumentation")
  Instrumentation.callApplicationOnCreate.implementation = function (app: Java.Wrapper) {
    if (!isChromiumBrowser(app)) enableDebugging()
    return this.callApplicationOnCreate(app)
  }
})
