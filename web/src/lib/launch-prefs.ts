import { useSyncExternalStore } from "react"

const providerKey = "holtdroid:provider"
const locationKey = (provider: string) => `holtdroid:location:${provider || "*"}`
const screenKey = (provider: string) => `holtdroid:screen:${provider || "*"}`
const androidKey = (provider: string) => `holtdroid:android:${provider || "*"}`
const webviewKey = (provider: string) => `holtdroid:webview:${provider || "*"}`

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    return
  }
}

export const lastProvider = () => read(providerKey)

export const lastLocation = (provider: string) => read(locationKey(provider))

export const rememberLocation = (provider: string, location: string) => write(locationKey(provider), location)

export const lastScreen = (provider: string) => read(screenKey(provider))

export const lastAndroid = (provider: string) => read(androidKey(provider))

export const lastWebView = (provider: string) => read(webviewKey(provider))

export function rememberLaunch(
  provider: string,
  location?: string,
  screen?: string,
  android?: string,
  webview?: string,
) {
  write(providerKey, provider)
  if (location) rememberLocation(provider, location)
  if (screen) write(screenKey(provider), screen)
  if (android) write(androidKey(provider), android)
  if (webview !== undefined) write(webviewKey(provider), webview)
}

const backendsKey = (pkg: string) => `holtdroid:backends:${pkg}`

/** The backends a network region last used for an app, one per line. */
export function lastBackends(pkg: string): string[] {
  return (read(backendsKey(pkg)) ?? "").split("\n").filter(Boolean)
}

export const rememberBackends = (pkg: string, backends: string[]) => write(backendsKey(pkg), backends.join("\n"))

const recordKey = "holtdroid:record"

/** Whether to record sessions, or null to follow the server. */
export function recordPreference(): boolean | null {
  const v = read(recordKey)
  return v === "1" ? true : v === "0" ? false : null
}

export const rememberRecord = (record: boolean) => write(recordKey, record ? "1" : "0")

export type QuickLaunchMode = "fresh" | "data" | "cache"

const quickModeKey = "holtdroid:quick-launch"

export function quickLaunchMode(): QuickLaunchMode {
  const v = read(quickModeKey)
  return v === "fresh" || v === "cache" ? v : "data"
}

export const rememberQuickLaunchMode = (mode: QuickLaunchMode) => write(quickModeKey, mode)

const favoritesKey = "holtdroid:favorite-screens"
const favoriteListeners = new Set<() => void>()

function loadFavorites(): string[] {
  try {
    const parsed: unknown = JSON.parse(read(favoritesKey) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

let favorites = loadFavorites()

function changed() {
  favorites = loadFavorites()
  for (const l of favoriteListeners) l()
}

function subscribeFavorites(listener: () => void) {
  favoriteListeners.add(listener)
  window.addEventListener("storage", changed)
  return () => {
    favoriteListeners.delete(listener)
    window.removeEventListener("storage", changed)
  }
}

export const useFavoriteScreens = () => useSyncExternalStore(subscribeFavorites, () => favorites)

export function toggleFavoriteScreen(id: string) {
  write(favoritesKey, JSON.stringify(favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id]))
  changed()
}
