const key = (provider: string) => `holtdroid:location:${provider}`

export function lastLocation(provider: string): string | null {
  try {
    return localStorage.getItem(key(provider))
  } catch {
    return null
  }
}

export function rememberLocation(provider: string, location: string) {
  try {
    localStorage.setItem(key(provider), location)
  } catch {
    return
  }
}
