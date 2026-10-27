const tokenKey = "holtdroid:figma-token"
const infoKey = "holtdroid:figma-token-info"

export type BrowserTokenInfo = { handle: string; hint: string; savedAt: string }

/** The Figma token kept in this browser, used where the server can't keep it with the account. */
export function browserFigmaToken() {
  try {
    return localStorage.getItem(tokenKey) ?? ""
  } catch {
    return ""
  }
}

export function browserFigmaInfo(): BrowserTokenInfo | null {
  try {
    const raw = localStorage.getItem(infoKey)
    return raw && browserFigmaToken() ? (JSON.parse(raw) as BrowserTokenInfo) : null
  } catch {
    return null
  }
}

export function storeBrowserFigmaToken(token: string, info?: Omit<BrowserTokenInfo, "savedAt">) {
  try {
    if (token && info) {
      localStorage.setItem(tokenKey, token)
      localStorage.setItem(infoKey, JSON.stringify({ ...info, savedAt: new Date().toISOString() }))
    } else {
      localStorage.removeItem(tokenKey)
      localStorage.removeItem(infoKey)
    }
  } catch {
    // storage may be unavailable; the token then isn't remembered
  }
}

/** A link copied with Figma's Copy link to selection. */
export function isFigmaLink(text: string) {
  return /^https:\/\/(www\.)?figma\.com\/(design|file|proto)\/[^\s]+node-id=/.test(text.trim())
}
