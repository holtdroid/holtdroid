import { useSyncExternalStore } from "react"
import type { RecordMode } from "@/lib/recorder"

export type VideoCodec = "h264" | "h265" | "av1"
export type KeyboardMode = "text" | "uhid"
export type LockMode = "lock" | "screen-off"
export type DeviceTheme = "manual" | "sync"
export type ClipboardSync = "both" | "to-device" | "from-device"

export type ScreenPrefs = {
  codec: VideoCodec
  quality: number
  maxFps: number
  lowFps: number
  streamFor: string
  bitRate: number
  keyboard: KeyboardMode
  audio: boolean
  vibrationSound: boolean
  lockMode: LockMode
  recordMode: RecordMode
  recordAuto: boolean
  deviceTheme: DeviceTheme
  railLabels: boolean
  autoFit: boolean
  keyboardLayouts: string[] | null
  clipboard: boolean
  clipboardSync: ClipboardSync
}

export const defaultScreenPrefs: ScreenPrefs = {
  codec: "h264",
  quality: 0,
  maxFps: 0,
  lowFps: 0,
  streamFor: "",
  bitRate: 4_000_000,
  keyboard: "text",
  audio: true,
  vibrationSound: true,
  lockMode: "lock",
  recordMode: "screen",
  recordAuto: false,
  deviceTheme: "manual",
  railLabels: true,
  autoFit: true,
  keyboardLayouts: null,
  clipboard: true,
  clipboardSync: "both",
}

const key = "holtdroid:screen"
const perSession = ["quality", "maxFps", "streamFor"] as const
const listeners = new Set<() => void>()

function load(): ScreenPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<ScreenPrefs>
    for (const k of perSession) delete saved[k]
    return { ...defaultScreenPrefs, ...saved }
  } catch {
    return defaultScreenPrefs
  }
}

let current = load()

function save(prefs: ScreenPrefs) {
  try {
    const saved: Partial<ScreenPrefs> = { ...prefs }
    for (const k of perSession) delete saved[k]
    localStorage.setItem(key, JSON.stringify(saved))
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

export function getScreenPrefs() {
  return current
}

export function useScreenPrefs() {
  return useSyncExternalStore(subscribe, () => current)
}
