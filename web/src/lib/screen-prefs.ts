import { useSyncExternalStore } from "react"

export type VideoCodec = "h264" | "h265" | "av1"
export type KeyboardMode = "text" | "uhid"
export type LockMode = "lock" | "screen-off"
export type DeviceTheme = "manual" | "sync"
export type ClipboardSync = "both" | "to-device" | "from-device"

export type ScreenPrefs = {
  codec: VideoCodec
  maxSize: number
  maxFps: number
  bitRate: number
  keyboard: KeyboardMode
  audio: boolean
  lockMode: LockMode
  deviceTheme: DeviceTheme
  keyboardLayouts: string[] | null
  clipboard: boolean
  clipboardSync: ClipboardSync
}

export const defaultScreenPrefs: ScreenPrefs = {
  codec: "h264",
  maxSize: 0,
  maxFps: 60,
  bitRate: 4_000_000,
  keyboard: "text",
  audio: true,
  lockMode: "lock",
  deviceTheme: "manual",
  keyboardLayouts: null,
  clipboard: true,
  clipboardSync: "both",
}

const key = "holtdroid:screen"
const listeners = new Set<() => void>()

function load(): ScreenPrefs {
  try {
    return { ...defaultScreenPrefs, ...(JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<ScreenPrefs>) }
  } catch {
    return defaultScreenPrefs
  }
}

let current = load()

function save(prefs: ScreenPrefs) {
  try {
    localStorage.setItem(key, JSON.stringify(prefs))
  } catch {
    return
  }
}

export function setScreenPrefs(patch: Partial<ScreenPrefs>) {
  current = { ...current, ...patch }
  save(current)
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useScreenPrefs() {
  return useSyncExternalStore(subscribe, () => current)
}
