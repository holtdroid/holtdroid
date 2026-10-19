const providerKey = "holtdroid:provider"
const locationKey = (provider: string) => `holtdroid:location:${provider || "*"}`

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

export function rememberLaunch(provider: string, location: string | undefined) {
  write(providerKey, provider)
  if (location) rememberLocation(provider, location)
}

export type QuickLaunchMode = "fresh" | "data" | "cache"

const quickModeKey = "holtdroid:quick-launch"

export function quickLaunchMode(): QuickLaunchMode {
  const v = read(quickModeKey)
  return v === "fresh" || v === "cache" ? v : "data"
}

export const rememberQuickLaunchMode = (mode: QuickLaunchMode) => write(quickModeKey, mode)
