import Java from "frida-java-bridge"

rpc.exports = {
  setLocales(tags) {
    return new Promise((resolve) => {
      Java.perform(() => {
        try {
          const locales = Java.use("android.os.LocaleList").forLanguageTags(tags)
          Java.use("com.android.internal.app.LocalePicker").updateLocales(locales)
          resolve({})
        } catch (e) {
          resolve({ error: String(e) })
        }
      })
    })
  },
}
