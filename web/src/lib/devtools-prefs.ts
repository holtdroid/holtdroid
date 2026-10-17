import { useSyncExternalStore } from "react"

export type DevToolsPrefs = {
  portalStyle: boolean
  screencast: boolean
}

export const defaultDevToolsPrefs: DevToolsPrefs = {
  portalStyle: true,
  screencast: false,
}

const key = "holtdroid:devtools"
const listeners = new Set<() => void>()

function load(): DevToolsPrefs {
  try {
    return { ...defaultDevToolsPrefs, ...(JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<DevToolsPrefs>) }
  } catch {
    return defaultDevToolsPrefs
  }
}

let current = load()

function save(prefs: DevToolsPrefs) {
  try {
    localStorage.setItem(key, JSON.stringify(prefs))
  } catch {
    return
  }
}

export function setDevToolsPrefs(patch: Partial<DevToolsPrefs>) {
  current = { ...current, ...patch }
  save(current)
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useDevToolsPrefs() {
  return useSyncExternalStore(subscribe, () => current)
}
