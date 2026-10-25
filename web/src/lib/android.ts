export type PackageInfo = {
  versionName?: string
  versionCode?: string
  targetSdk?: string
  firstInstallTime?: string
  lastUpdateTime?: string
  permissions: { name: string; granted: boolean }[]
}

// parsePackage reads `dumpsys package <pkg>`: the first package block and
// its runtime permissions for user 0.
export function parsePackage(out: string): PackageInfo {
  const info: PackageInfo = { permissions: [] }
  const field = (name: string) => new RegExp(`^\\s+${name}=(\\S+)`, "m").exec(out)?.[1]
  info.versionName = field("versionName")
  info.versionCode = field("versionCode")
  info.targetSdk = /targetSdk=(\d+)/.exec(out)?.[1]
  info.firstInstallTime = /firstInstallTime=(.+)$/m.exec(out)?.[1]?.trim()
  info.lastUpdateTime = /lastUpdateTime=(.+)$/m.exec(out)?.[1]?.trim()
  const start = out.indexOf("runtime permissions:")
  if (start >= 0) {
    for (const line of out.slice(start).split("\n").slice(1)) {
      const m = /^\s+([\w.]+): granted=(true|false)/.exec(line)
      if (!m?.[1]) break
      info.permissions.push({ name: m[1], granted: m[2] === "true" })
    }
  }
  return info
}

export const apiLevels: Record<string, number> = { "11": 30, "12": 31, "13": 33, "14": 34, "15": 35, "16": 36 }

export type WebViewInfo = {
  current?: { pkg: string; version: string }
  valid: { pkg: string; version: string }[]
}

export function parseWebView(out: string): WebViewInfo {
  const current = /Current WebView package \(name, version\): \(([^,]+), ([^)]+)\)/.exec(out)
  const valid = [...out.matchAll(/Valid package (\S+) \(versionName: ([^,]+),/g)].map((m) => ({
    pkg: m[1] ?? "",
    version: m[2] ?? "",
  }))
  return { current: current?.[1] && current[2] ? { pkg: current[1], version: current[2] } : undefined, valid }
}

export function parseProps(out: string): Record<string, string> {
  const props: Record<string, string> = {}
  for (const m of out.matchAll(/^\[([^\]]+)\]: \[(.*)\]$/gm)) {
    if (m[1]) props[m[1]] = m[2] ?? ""
  }
  return props
}

export const standbyBuckets = [
  { value: "10", label: "Active" },
  { value: "20", label: "Working set" },
  { value: "30", label: "Frequent" },
  { value: "40", label: "Rare" },
  { value: "45", label: "Restricted" },
]

export const bucketNames: Record<string, string> = {
  "10": "active",
  "20": "working_set",
  "30": "frequent",
  "40": "rare",
  "45": "restricted",
}

export function permissionLabel(name: string) {
  return name.replace(/^android\.permission\./, "")
}
