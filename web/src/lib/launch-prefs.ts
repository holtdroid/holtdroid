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

export type QuickLaunchMode = "fresh" | "data" | "cache"

const quickModeKey = "holtdroid:quick-launch"

export function quickLaunchMode(): QuickLaunchMode {
  const v = read(quickModeKey)
  return v === "fresh" || v === "cache" ? v : "data"
}

export const rememberQuickLaunchMode = (mode: QuickLaunchMode) => write(quickModeKey, mode)
