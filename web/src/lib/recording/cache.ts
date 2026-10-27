import type { DevToolsRequest } from "@/api/client"
import { localScheme, resourceGroup } from "@/lib/recording/devtools"
import { detectStamp, formatSpan, type StampUnit } from "@/lib/recording/timestamps"

export type CacheRequest = DevToolsRequest & { key: string }

export type CacheSeverity = "error" | "warning" | "info"

export type CacheRule =
  | "buster"
  | "changing-param"
  | "cdn-private"
  | "cdn-miss"
  | "cdn-bypass"
  | "cdn-dynamic"
  | "cdn-stale"
  | "repeat"
  | "no-policy"
  | "no-store"
  | "no-validator"
  | "short-hashed"
  | "set-cookie"
  | "vary"
  | "fresh-asked"
  | "legacy"

/** Where the response came from: the WebView's own caches, a 304 or the network. */
export type CacheServed = "memory" | "disk" | "service-worker" | "prefetch" | "revalidated" | "network"

export type CdnInfo = { name: string; status: string; kind: "hit" | "miss" | "uncached" }

/** A URL part that carries the time it was requested, so every request has a URL of its own. */
export type Buster = {
  where: "query" | "path"
  name: string
  value: string
  unit: StampUnit
  delta: number
  index?: number
}

export type CacheEntry = {
  r: CacheRequest
  served: CacheServed
  directives: Map<string, string | true>
  /** seconds the browser may reuse it without asking; 0 for no-cache and max-age=0, undefined without any */
  lifetime?: number
  /** seconds a shared cache such as a CDN may keep it */
  sharedLifetime?: number
  validator: boolean
  cdn?: CdnInfo
  busters: Buster[]
  /** the URL with the busters left out, what a cache would key on if it could */
  stable: string
  hashed: boolean
  isStatic: boolean
}

export type CacheFinding = {
  id: string
  rule: CacheRule
  severity: CacheSeverity
  title: string
  detail: string
  subject: string
  requests: string[]
  /** bytes downloaded that a cache could have served */
  wasted?: number
}

export type CacheSummary = {
  requests: number
  browser: number
  revalidated: number
  network: number
  cdn: { hit: number; miss: number; uncached: number }
  bytes: number
  wasted: number
  errors: number
  warnings: number
  infos: number
}

export type CacheReport = { entries: CacheEntry[]; findings: CacheFinding[]; summary: CacheSummary }

const skippedTypes = new Set(["Preflight", "WebSocket", "EventSource", "Ping", "CSPViolationReport", "SignedExchange"])
const staticGroups = new Set(["js", "css", "img", "media", "font"])
const stampWindow = 60 * 60_000
const dateWindow = 36 * 60 * 60_000
const longLived = 7 * 86_400

export function header(h: Record<string, string> | undefined, name: string) {
  for (const [k, v] of Object.entries(h ?? {})) if (k.toLowerCase() === name) return v
  return undefined
}

/** Cache-Control's directives, lower-cased, with their values unquoted. */
export function parseCacheControl(value: string | undefined) {
  const out = new Map<string, string | true>()
  for (const part of (value ?? "").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const m = /^\s*([^=\s]+)\s*(?:=\s*(?:"([^"]*)"|([^\s]*)))?\s*$/.exec(part)
    if (!m) continue
    out.set(m[1]!.toLowerCase(), m[2] ?? m[3] ?? true)
  }
  return out
}

const seconds = (v: string | true | undefined) => {
  if (typeof v !== "string") return undefined
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function lifetimes(r: DevToolsRequest, d: Map<string, string | true>) {
  if (d.has("no-store")) return { lifetime: 0, sharedLifetime: 0 }
  const maxAge = seconds(d.get("max-age"))
  let lifetime = d.has("no-cache") ? 0 : maxAge
  if (lifetime === undefined) {
    const expires = header(r.responseHeaders, "expires")
    if (expires !== undefined) {
      const at = Date.parse(expires)
      const date = Date.parse(header(r.responseHeaders, "date") ?? "") || r.wall || Date.now()
      lifetime = Number.isFinite(at) ? Math.max(0, Math.round((at - date) / 1000)) : 0
    }
  }
  const cdn = parseCacheControl(
    header(r.responseHeaders, "cloudflare-cdn-cache-control") ?? header(r.responseHeaders, "cdn-cache-control"),
  )
  const sharedLifetime = d.has("private")
    ? 0
    : (seconds(cdn.get("s-maxage")) ?? seconds(cdn.get("max-age")) ?? seconds(d.get("s-maxage")) ?? lifetime)
  return { lifetime, sharedLifetime }
}

export function cdnOf(h: Record<string, string> | undefined): CdnInfo | undefined {
  const cf = header(h, "cf-cache-status")?.trim().toUpperCase()
  if (cf) {
    const kind = ["HIT", "REVALIDATED", "UPDATING", "STALE"].includes(cf)
      ? "hit"
      : ["MISS", "EXPIRED"].includes(cf)
        ? "miss"
        : "uncached"
    return { name: "Cloudflare", status: cf, kind }
  }
  const x = header(h, "x-cache") ?? header(h, "x-cache-status") ?? header(h, "cdn-cache")
  if (!x) return undefined
  const name = header(h, "x-amz-cf-id")
    ? "CloudFront"
    : /cache-/.test(header(h, "x-served-by") ?? "")
      ? "Fastly"
      : header(h, "x-cache-status")
        ? "nginx"
        : "CDN"
  const status = x.split(",")[0]!.trim()
  const kind = /hit|stale|revalidated/i.test(status)
    ? "hit"
    : /miss|expired|refresh/i.test(status)
      ? "miss"
      : "uncached"
  return { name, status, kind }
}

const mixed = (v: string) => /\d/.test(v) && /[a-z]/i.test(v)

/** A file name with a content hash in it, as bundlers write them: app.3f9a8c1d.js, chunk-BX2KQ7aZ.css. */
export function isHashed(url: string) {
  try {
    const u = new URL(url)
    const hash = /[._~-]([A-Za-z0-9_]{8,})\.[a-z0-9]+$/.exec(u.pathname.split("/").at(-1) ?? "")?.[1]
    return (!!hash && mixed(hash)) || [...u.searchParams.values()].some((v) => /^[0-9a-f]{8,}$/i.test(v) && mixed(v))
  } catch {
    return false
  }
}

/** The query parameters and path segments that hold a time within an hour of when it was sent (a date within a day and a half). */
export function findBusters(url: string, wall: number | undefined): Buster[] {
  if (!wall) return []
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return []
  }
  const out: Buster[] = []
  const check = (where: Buster["where"], name: string, value: string, index?: number) => {
    const s = detectStamp(value, name, wall)
    if (!s || s.unit === "http") return
    const delta = s.ms - wall
    if (Math.abs(delta) <= (s.unit === "date" ? dateWindow : stampWindow))
      out.push({ where, name, value, unit: s.unit, delta, index })
  }
  for (const [name, value] of u.searchParams) check("query", name, value)
  for (const [i, seg] of u.pathname.split("/").entries()) {
    const v = decodeURIComponent(seg)
    if (/^\d{9,19}$|^\d{4}-\d{2}-\d{2}/.test(v)) check("path", `segment ${i}`, v, i)
  }
  return out
}

function stableURL(url: string, busters: Buster[]) {
  if (!busters.length) return url
  try {
    const u = new URL(url)
    for (const b of busters) if (b.where === "query") u.searchParams.delete(b.name)
    const segs = u.pathname.split("/")
    for (const b of busters) if (b.where === "path") segs[b.index!] = "{time}"
    u.pathname = segs.join("/")
    return u.toString()
  } catch {
    return url
  }
}

function served(r: DevToolsRequest): CacheServed {
  if (r.cached) return r.cached
  return r.status === 304 ? "revalidated" : "network"
}

/** Whether a request's response is one a cache could keep at all: a GET or HEAD that finished with a cacheable status. */
export function cacheable(r: DevToolsRequest) {
  const status = r.status ?? 0
  return (
    (r.method === "GET" || r.method === "HEAD") &&
    !r.error &&
    !localScheme(r.url) &&
    !skippedTypes.has(r.resourceType ?? "") &&
    [200, 203, 204, 206, 300, 301, 304, 308, 404, 410].includes(status)
  )
}

export function cacheEntry(r: CacheRequest): CacheEntry {
  const directives = parseCacheControl(header(r.responseHeaders, "cache-control"))
  const busters = findBusters(r.url, r.wall)
  const group = resourceGroup(r.resourceType)
  return {
    r,
    served: served(r),
    directives,
    ...lifetimes(r, directives),
    validator: !!(header(r.responseHeaders, "etag") || header(r.responseHeaders, "last-modified")),
    cdn: cdnOf(r.responseHeaders),
    busters,
    stable: stableURL(r.url, busters),
    hashed: isHashed(r.url),
    isStatic: staticGroups.has(group) || r.resourceType === "Manifest",
  }
}

const shortURL = (url: string) => {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname}`
  } catch {
    return url
  }
}

const describeStamp = (b: Buster) =>
  `${b.where === "query" ? `\`${b.name}=${b.value}\`` : `the path's \`${b.value}\``} is ${
    b.unit === "date" ? "the date it was requested" : `the time it was requested (${formatSpan(b.delta)} apart)`
  }`

function groupBy<T>(items: T[], key: (v: T) => string | undefined) {
  const out = new Map<string, T[]>()
  for (const v of items) {
    const k = key(v)
    if (k === undefined) continue
    const list = out.get(k)
    if (list) list.push(v)
    else out.set(k, [v])
  }
  return out
}

const bytes = (es: CacheEntry[]) => es.reduce((n, e) => n + (e.served === "network" ? (e.r.size ?? 0) : 0), 0)
const keys = (es: CacheEntry[]) => es.map((e) => e.r.key)
const randomish = (v: string) => v.length >= 6 && /\d/.test(v) && /^[\w.~-]+$/.test(v)

/**
 * Looks at how well a WebView's requests use the browser's cache and a CDN
 * in front of the server: missing or contradicting caching headers, URLs
 * with the request time in them, Cloudflare (or another CDN) not caching or
 * caching what it shouldn't, and the same resource downloaded again.
 */
export function analyzeCache(requests: CacheRequest[]): CacheReport {
  const entries = requests.filter(cacheable).map(cacheEntry)
  const findings: CacheFinding[] = []
  const add = (f: Omit<CacheFinding, "id">) => findings.push({ ...f, id: `${f.rule}:${f.subject}` })

  for (const [stable, es] of groupBy(entries, (e) => (e.busters.length ? `${e.r.method} ${e.stable}` : undefined))) {
    const e = es.at(-1)!
    const stored = (e.lifetime ?? 0) > 0 || (e.sharedLifetime ?? 0) > 0 || e.cdn !== undefined
    add({
      rule: "buster",
      severity: stored ? "error" : "warning",
      subject: stable,
      title: `Request time in the URL of ${shortURL(e.r.url)}`,
      detail: `${describeStamp(e.busters[0]!)}, so every request has a URL of its own and neither the WebView${
        e.cdn ? ` nor ${e.cdn.name}` : ""
      } can reuse an earlier response${
        stored ? ", although the caching headers allow it" : ""
      }. Leave it out, or put a version or content hash there instead.`,
      requests: keys(es),
      wasted: es.length > 1 ? bytes(es.slice(1)) : undefined,
    })
  }

  const buster = new Set(entries.flatMap((e) => (e.busters.length ? [e.r.key] : [])))
  for (const es of groupBy(entries, (e) => {
    if (buster.has(e.r.key)) return undefined
    try {
      const u = new URL(e.r.url)
      return `${e.r.method} ${u.origin}${u.pathname}?${[...u.searchParams.keys()].sort().join("&")}`
    } catch {
      return undefined
    }
  }).values()) {
    if (es.length < 3) continue
    const params = new Map<string, string[]>()
    for (const e of es) for (const [k, v] of new URL(e.r.url).searchParams) params.set(k, [...(params.get(k) ?? []), v])
    for (const [name, values] of params) {
      if (new Set(values).size !== values.length || !values.every(randomish)) continue
      const e = es.at(-1)!
      add({
        rule: "changing-param",
        severity: "warning",
        subject: `${shortURL(e.r.url)}?${name}`,
        title: `\`${name}\` changes on every request to ${shortURL(e.r.url)}`,
        detail: `${values.length} requests, ${values.length} different values (${values.slice(-3).join(", ")}…). If it is a cache-buster or a nonce, every response is a miss.`,
        requests: keys(es),
        wasted: bytes(es.slice(1)),
      })
    }
  }

  for (const [url, es] of groupBy(entries, (e) => e.r.url)) {
    const fetched = es.filter((e) => e.served === "network" && (e.r.status === 200 || e.r.status === 203))
    if (fetched.length >= 2) {
      const first = fetched[0]!
      const fresh = fetched.slice(1).some((e) => {
        const age = ((e.r.wall ?? 0) - (first.r.wall ?? 0)) / 1000
        return (first.lifetime ?? 0) > age
      })
      const asked = fetched.slice(1).some((e) => freshAsked(e.r))
      add({
        rule: "repeat",
        severity: "warning",
        subject: url,
        title: `${shortURL(url)} downloaded ${fetched.length} times`,
        detail: fresh
          ? `Its headers let the WebView reuse it, yet it was fetched again${
              asked ? ": the request asked for a fresh copy" : ""
            }.`
          : first.lifetime === undefined
            ? `No Cache-Control or Expires, ${first.validator ? "and it wasn't revalidated with a 304" : "and nothing to revalidate it with"}.`
            : first.validator
              ? "It must be revalidated each time, but the server answered with the whole body instead of 304 Not Modified."
              : "It must be revalidated each time and has no ETag or Last-Modified, so the whole body comes every time.",
        requests: keys(fetched),
        wasted: bytes(fetched.slice(1)),
      })
    }
    const misses = es.filter((e) => e.cdn?.kind === "miss")
    if (misses.length >= 2) {
      const e = misses.at(-1)!
      add({
        rule: "cdn-miss",
        severity: "warning",
        subject: url,
        title: `${e.cdn!.name} missed ${shortURL(url)} ${misses.length} times`,
        detail: `${misses.map((m) => m.cdn!.status).join(", ")}. ${
          (e.sharedLifetime ?? 0) < 60
            ? `It may keep it only ${e.sharedLifetime ?? 0} s.`
            : "A Vary header, another edge location, or a purge between requests can do that."
        }`,
        requests: keys(misses),
      })
    }
  }

  const perURL = (
    rule: CacheRule,
    pick: (e: CacheEntry) => Omit<CacheFinding, "id" | "rule" | "subject" | "requests"> | undefined,
  ) => {
    for (const [stable, es] of groupBy(entries, (e) => e.stable)) {
      const f = pick(representative(es))
      if (f) add({ rule, subject: stable, requests: keys(es), ...f })
    }
  }

  perURL("cdn-private", (e) => {
    if (e.cdn?.kind !== "hit") return undefined
    const marks = ["private", "no-store"].filter((d) => e.directives.has(d))
    const cookie = header(e.r.responseHeaders, "set-cookie")
    if (!marks.length && !cookie) return undefined
    return {
      severity: "error",
      title: `${e.cdn.name} serves a cached copy of ${shortURL(e.r.url)} that ${marks.length ? `is marked ${marks.join(", ")}` : "sets a cookie"}`,
      detail: `${e.cdn.status}${header(e.r.responseHeaders, "age") ? ` with Age ${header(e.r.responseHeaders, "age")} s` : ""}: another user may get this response${cookie ? " and its cookie" : ""}. A cache rule likely overrides the origin's headers.`,
    }
  })

  perURL("cdn-bypass", (e) => {
    if (e.cdn?.status !== "BYPASS") return undefined
    const why = [
      ...["private", "no-store", "no-cache"].filter((d) => e.directives.has(d)).map((d) => `Cache-Control: ${d}`),
      ...(e.directives.get("max-age") === "0" ? ["max-age=0"] : []),
      ...(header(e.r.responseHeaders, "set-cookie") ? ["Set-Cookie"] : []),
      ...(header(e.r.requestHeaders, "authorization") ? ["an Authorization header"] : []),
    ]
    return {
      severity: e.isStatic ? "warning" : "info",
      title: `${e.cdn.name} bypassed its cache for ${shortURL(e.r.url)}`,
      detail: why.length
        ? `Because of ${why.join(", ")}.`
        : "The origin's headers don't explain it: a cache rule or a Page Rule says to bypass.",
    }
  })

  perURL("cdn-dynamic", (e) =>
    e.cdn?.status === "DYNAMIC" && (e.isStatic || (e.sharedLifetime ?? 0) > 0)
      ? {
          severity: "warning",
          title: `${e.cdn.name} doesn't cache ${shortURL(e.r.url)}`,
          detail: e.isStatic
            ? "DYNAMIC: nothing lets it cache this file. Cloudflare caches only some extensions by default; send Cache-Control with a max-age or add a cache rule."
            : `DYNAMIC although its headers allow caching for ${formatSpan((e.sharedLifetime ?? 0) * 1000)}: Cloudflare doesn't cache HTML or JSON by default, a cache rule makes it eligible.`,
        }
      : undefined,
  )

  perURL("cdn-stale", (e) => {
    const age = seconds(header(e.r.responseHeaders, "age"))
    if (e.cdn?.kind !== "hit" || age === undefined || e.sharedLifetime === undefined || age <= e.sharedLifetime)
      return undefined
    return {
      severity: "info",
      title: `${e.cdn.name} served ${shortURL(e.r.url)} past its lifetime`,
      detail: `Age ${formatSpan(age * 1000)}, but it may be kept ${formatSpan(e.sharedLifetime * 1000)}: stale-while-revalidate, an edge TTL override, or a stale copy.`,
    }
  })

  perURL("no-policy", (e) => {
    if (e.lifetime !== undefined || e.r.status !== 200 || e.served !== "network") return undefined
    const lm = header(e.r.responseHeaders, "last-modified")
    if (!e.isStatic && resourceGroup(e.r.resourceType) !== "doc") return undefined
    return {
      severity: e.isStatic ? "warning" : "info",
      title: `No caching headers on ${shortURL(e.r.url)}`,
      detail: lm
        ? "Neither Cache-Control nor Expires: the WebView guesses a lifetime from Last-Modified (a tenth of its age), and CDNs fall back to their own defaults."
        : "Neither Cache-Control, Expires nor a validator: the WebView downloads it again every time.",
    }
  })

  perURL("no-store", (e) =>
    e.isStatic && e.directives.has("no-store")
      ? {
          severity: "warning",
          title: `${shortURL(e.r.url)} is no-store`,
          detail: e.hashed
            ? "The file name has a content hash, so it never changes: it can be cached for a year with immutable."
            : "A static file nobody may keep is downloaded on every load. no-cache with an ETag keeps it fresh and still saves the body.",
        }
      : undefined,
  )

  perURL("no-validator", (e) =>
    e.lifetime === 0 && !e.directives.has("no-store") && !e.validator && e.r.status === 200
      ? {
          severity: e.isStatic ? "warning" : "info",
          title: `${shortURL(e.r.url)} must be revalidated but has nothing to revalidate with`,
          detail: `${e.directives.has("no-cache") ? "no-cache" : "A zero lifetime"} without ETag or Last-Modified: instead of a short 304 the whole body comes every time.`,
        }
      : undefined,
  )

  perURL("short-hashed", (e) =>
    e.isStatic && e.hashed && (e.lifetime ?? 0) < longLived && !e.directives.has("no-store")
      ? {
          severity: "info",
          title: `${shortURL(e.r.url)} has a content hash but a short lifetime`,
          detail: `${e.lifetime === undefined ? "No lifetime" : e.lifetime === 0 ? "A zero lifetime" : `A lifetime of ${formatSpan(e.lifetime * 1000)}`}: a hashed file never changes, Cache-Control: public, max-age=31536000, immutable saves every revalidation.`,
        }
      : undefined,
  )

  perURL("set-cookie", (e) => {
    if (!header(e.r.responseHeaders, "set-cookie") || e.cdn?.kind === "hit") return undefined
    const shared = e.directives.has("public") || e.directives.has("s-maxage")
    if (!shared && !e.isStatic) return undefined
    return {
      severity: shared ? "warning" : "info",
      title: `${shortURL(e.r.url)} sets a cookie`,
      detail: shared
        ? "It is marked for shared caches too: a CDN either refuses to cache it or hands the cookie to everyone."
        : "Most CDNs, Cloudflare included, don't cache responses with Set-Cookie, so this static file always comes from the origin.",
    }
  })

  perURL("vary", (e) => {
    const vary = (header(e.r.responseHeaders, "vary") ?? "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter((v) => ["*", "cookie", "user-agent", "authorization"].includes(v))
    if (!vary.length) return undefined
    return {
      severity: vary.includes("*") ? "error" : "warning",
      title: `${shortURL(e.r.url)} varies by ${vary.join(", ")}`,
      detail: vary.includes("*")
        ? "Vary: * means no cache may reuse it."
        : "Each value gets a copy of its own, so a CDN keeps many copies and rarely hits; Cloudflare ignores Vary except Accept-Encoding and caches only one.",
    }
  })

  perURL("legacy", (e) => {
    const pragma = header(e.r.responseHeaders, "pragma")
    if (!pragma || header(e.r.responseHeaders, "cache-control")) return undefined
    return {
      severity: "info",
      title: `${shortURL(e.r.url)} has only Pragma: ${pragma}`,
      detail: "Pragma is an HTTP/1.0 request header; caches ignore it in responses. Send Cache-Control.",
    }
  })

  const asked = entries.filter((e) => freshAsked(e.r))
  if (asked.length) {
    const most = asked.length >= entries.length * 0.8 && entries.length >= 5
    add({
      rule: "fresh-asked",
      severity: most ? "warning" : "info",
      subject: "requests",
      title: most ? "Almost every request asked for a fresh copy" : `${asked.length} requests asked for a fresh copy`,
      detail: most
        ? "Cache-Control: no-cache or Pragma: no-cache on the requests themselves: DevTools' Disable cache is likely on, so what you see here isn't how the app caches."
        : "The app sent Cache-Control: no-cache or Pragma: no-cache (fetch's cache option, or a reload), so the cache was skipped for them.",
      requests: keys(asked),
    })
  }

  const rank: Record<CacheSeverity, number> = { error: 0, warning: 1, info: 2 }
  findings.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] || (b.wasted ?? 0) - (a.wasted ?? 0) || b.requests.length - a.requests.length,
  )

  const summary: CacheSummary = {
    requests: entries.length,
    browser: entries.filter((e) => e.served !== "network" && e.served !== "revalidated").length,
    revalidated: entries.filter((e) => e.served === "revalidated").length,
    network: entries.filter((e) => e.served === "network").length,
    cdn: {
      hit: entries.filter((e) => e.cdn?.kind === "hit").length,
      miss: entries.filter((e) => e.cdn?.kind === "miss").length,
      uncached: entries.filter((e) => e.cdn?.kind === "uncached").length,
    },
    bytes: bytes(entries),
    wasted: findings
      .filter((f) => f.rule === "buster" || f.rule === "changing-param" || f.rule === "repeat")
      .reduce((n, f) => n + (f.wasted ?? 0), 0),
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    infos: findings.filter((f) => f.severity === "info").length,
  }
  return { entries, findings, summary }
}

/** The response that tells the most about a URL's headers: the last full one, else the last with any. */
function representative(es: CacheEntry[]) {
  return (
    es.findLast((e) => e.served === "network" && (e.r.status === 200 || e.r.status === 203)) ??
    es.findLast((e) => Object.keys(e.r.responseHeaders ?? {}).length > 0) ??
    es.at(-1)!
  )
}

/** Whether the request itself asked to skip the cache, as DevTools' Disable cache or fetch's cache: "no-cache" do. */
export function freshAsked(r: DevToolsRequest) {
  const cc = parseCacheControl(header(r.requestHeaders, "cache-control"))
  return (
    cc.has("no-cache") ||
    cc.has("no-store") ||
    (/no-cache/i.test(header(r.requestHeaders, "pragma") ?? "") && !header(r.requestHeaders, "cache-control")) ||
    (cc.get("max-age") === "0" && r.resourceType !== "Document")
  )
}
