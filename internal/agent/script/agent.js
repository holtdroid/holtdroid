import Java from "frida-java-bridge"

let application = null

function enableDebugging() {
  try {
    Java.use("android.webkit.WebView").setWebContentsDebuggingEnabled(true)
  } catch (e) {
    console.warn(`setWebContentsDebuggingEnabled: ${e}`)
  }
}

function currentApp() {
  const app = application ?? Java.use("android.app.ActivityThread").currentApplication()
  if (app === null) throw new Error("the app has not started yet")
  return app
}

function clipboardManager() {
  const Context = Java.use("android.content.Context")
  const service = currentApp().getSystemService(Context.CLIPBOARD_SERVICE.value)
  return Java.cast(service, Java.use("android.content.ClipboardManager"))
}

function readClip(manager) {
  const clip = manager.getPrimaryClip()
  if (clip === null || clip.getItemCount() === 0) return ""
  const text = clip.getItemAt(0).coerceToText(currentApp())
  return text === null ? "" : text.toString()
}

// Clip text travels as the message's binary data: frida-go treats any message
// whose JSON contains "frida:rpc" as an RPC reply.
function emitClip(text) {
  const bytes = Java.use("java.lang.String").$new(text).getBytes("UTF-8")
  const out = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] & 0xff
  send({ type: "clip" }, out.buffer)
}

function listenClipboard() {
  const Listener = Java.registerClass({
    name: "pet.holtdroid.ClipListener",
    implements: [Java.use("android.content.ClipboardManager$OnPrimaryClipChangedListener")],
    methods: {
      onPrimaryClipChanged() {
        try {
          emitClip(readClip(clipboardManager()))
        } catch (e) {
          console.warn(`clipboard listener: ${e}`)
        }
      },
    },
  })
  clipboardManager().addPrimaryClipChangedListener(Listener.$new())
}

function onMainThread(fn) {
  return new Promise((resolve) => {
    Java.scheduleOnMainThread(() => {
      try {
        resolve(fn())
      } catch (e) {
        resolve({ error: String(e) })
      }
    })
  })
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
  Instrumentation.callApplicationOnCreate.implementation = function (app) {
    application = Java.retain(app)
    enableDebugging()
    try {
      listenClipboard()
    } catch (e) {
      console.warn(`clipboard: ${e}`)
    }
    return this.callApplicationOnCreate(app)
  }
})

rpc.exports = {
  getClip() {
    return onMainThread(() => ({ text: readClip(clipboardManager()) }))
  },
  setClip(text) {
    return onMainThread(() => {
      const ClipData = Java.use("android.content.ClipData")
      const JString = Java.use("java.lang.String")
      clipboardManager().setPrimaryClip(ClipData.newPlainText(JString.$new("holtdroid"), JString.$new(text)))
      return {}
    })
  },
}
