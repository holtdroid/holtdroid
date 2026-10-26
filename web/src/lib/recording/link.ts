export type ToolTab = "logcat" | "network" | "console" | "sockets"

export const toolTabs: ToolTab[] = ["logcat", "network", "console", "sockets"]

/** What a link to a recording opens: a moment, a tab and the request, message, socket or frame open in it. */
export type PlayerView = {
  t?: number
  tab?: ToolTab
  request?: string
  message?: string
  socket?: string
  frame?: string
}

const fields = ["request", "message", "socket", "frame"] as const

/** Reads `#t=46.2&tab=network&request=…`; `t` also takes `1m20s` or `80`. */
export function parseView(hash: string): PlayerView {
  const q = new URLSearchParams(hash.replace(/^#/, ""))
  const view: PlayerView = {}
  const t = q.get("t")
  if (t) {
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/.exec(t)
    if (m && m[0]) view.t = Math.round(((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000)
  }
  const tab = q.get("tab")
  if (tab && (toolTabs as string[]).includes(tab)) view.tab = tab as ToolTab
  for (const f of fields) {
    const v = q.get(f)
    if (v) view[f] = v
  }
  return view
}

/** The hash for a view, with only what belongs to its tab. */
export function viewHash(view: PlayerView) {
  const q = new URLSearchParams()
  if (view.t !== undefined) q.set("t", (Math.max(0, view.t) / 1000).toFixed(1).replace(/\.0$/, ""))
  if (view.tab) q.set("tab", view.tab)
  const keep: Record<ToolTab, readonly (typeof fields)[number][]> = {
    logcat: [],
    network: ["request"],
    console: ["message"],
    sockets: ["socket", "frame"],
  }
  for (const f of view.tab ? keep[view.tab] : []) {
    const v = view[f]
    if (v) q.set(f, v)
  }
  const s = q.toString()
  return s ? `#${s}` : ""
}
