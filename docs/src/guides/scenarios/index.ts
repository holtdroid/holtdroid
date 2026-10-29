import type { Scenario } from "../types"

const scenarios: Record<string, () => Promise<{ default: Scenario }>> = {
  "launch-app": () => import("./launch-app"),
  "session-tour": () => import("./session-tour"),
  "quick-launch": () => import("./quick-launch"),
  "upload-apk": () => import("./upload-apk"),
  limits: () => import("./limits"),
  devtools: () => import("./devtools"),
  websockets: () => import("./websockets"),
  "webview-version": () => import("./webview-version"),
  vpn: () => import("./vpn"),
  network: () => import("./network"),
  gps: () => import("./gps"),
  "device-settings": () => import("./device-settings"),
  clipboard: () => import("./clipboard"),
  "app-data": () => import("./app-data"),
  "app-actions": () => import("./app-actions"),
  "switch-version": () => import("./switch-version"),
  crash: () => import("./crash"),
  files: () => import("./files"),
  "pixel-perfect": () => import("./pixel-perfect"),
  "record-share": () => import("./record-share"),
  "bug-report": () => import("./bug-report"),
  "connect-computer": () => import("./connect-computer"),
  "local-server": () => import("./local-server"),
}

export const guideIds = Object.keys(scenarios)

const cache = new Map<string, Promise<Scenario>>()

export function loadScenario(id: string) {
  let p = cache.get(id)
  if (!p) {
    const load = scenarios[id]
    p = load ? load().then((m) => m.default) : Promise.reject(new Error(`Unknown guide “${id}”`))
    cache.set(id, p)
  }
  return p
}
