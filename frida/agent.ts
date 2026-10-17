import Java from "frida-java-bridge"

function enableDebugging() {
  try {
    Java.use("android.webkit.WebView").setWebContentsDebuggingEnabled(true)
  } catch (e) {
    console.warn(`setWebContentsDebuggingEnabled: ${e}`)
  }
}

Java.perform(() => {
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

  const Instrumentation = Java.use("android.app.Instrumentation")
  Instrumentation.callApplicationOnCreate.implementation = function (app: Java.Wrapper) {
    enableDebugging()
    return this.callApplicationOnCreate(app)
  }
})
