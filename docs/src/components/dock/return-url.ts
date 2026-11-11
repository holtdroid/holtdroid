export const storageKey = "hd-return-url"
export const maxLength = 2048

const param = "returnUrl="

export function validReturnUrl(value: unknown, docsOrigin: string): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.username || url.password) return null
  if (url.origin === docsOrigin) return null
  return url.href.length > maxLength ? null : url.href
}

export function splitHash(hash: string): { returnUrl: string | null; rest: string } | null {
  const parts = hash.replace(/^#/, "").split("&")
  const at = parts.findIndex((p) => p.startsWith(param))
  if (at < 0) return null
  const raw = parts[at]!.slice(param.length)
  parts.splice(at, 1)
  const rest = parts.filter(Boolean).join("&")
  if (raw.length > maxLength * 3) return { returnUrl: null, rest }
  try {
    return { returnUrl: decodeURIComponent(raw), rest }
  } catch {
    return { returnUrl: null, rest }
  }
}

type Env = {
  location: Pick<Location, "hash" | "origin" | "pathname" | "search">
  history: Pick<History, "replaceState" | "state">
  sessionStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">
}

function read(env: Env) {
  try {
    return env.sessionStorage.getItem(storageKey)
  } catch {
    return null
  }
}

function write(env: Env, value: string | null) {
  try {
    if (value) env.sessionStorage.setItem(storageKey, value)
    else env.sessionStorage.removeItem(storageKey)
  } catch {}
}

export function resolveReturnUrl(env: Env): string | null {
  const { location } = env
  const fromHash = splitHash(location.hash)
  if (fromHash) {
    const url = validReturnUrl(fromHash.returnUrl, location.origin)
    if (url) write(env, url)
    try {
      env.history.replaceState(
        env.history.state,
        "",
        `${location.pathname}${location.search}${fromHash.rest ? `#${fromHash.rest}` : ""}`,
      )
    } catch {}
    if (url) return url
  }
  const stored = validReturnUrl(read(env), location.origin)
  if (!stored) write(env, null)
  return stored
}

const noStorage: Env["sessionStorage"] = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}

export function initPortalReturn(win: Window, root: ParentNode) {
  let storage = noStorage
  try {
    storage = win.sessionStorage
  } catch {}
  showPortalLinks(root, resolveReturnUrl({ location: win.location, history: win.history, sessionStorage: storage }))
}

export function showPortalLinks(root: ParentNode, url: string | null) {
  for (const link of root.querySelectorAll<HTMLAnchorElement>("a[data-hd-portal]")) {
    if (url) {
      link.href = url
      link.rel = "noopener"
      link.hidden = false
    } else {
      link.removeAttribute("href")
      link.hidden = true
    }
  }
}
