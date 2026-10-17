export type PortRule = { from: number; to: number; local?: number }

export type Forward = { device: number; local: number }

export const DEFAULT_PORT_RULES = ["80", "443", "3000-3010"]

const MAX_RANGE = 256
const rulesKey = "holtdroid:ssh:ports"
const adbKey = "holtdroid:ssh:adb"
const allKey = "holtdroid:ssh:all"

const isPort = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65535

export function parsePortRule(text: string): PortRule | string {
  const spec = text.replace(/\s+/g, "")
  const match = /^(\d+)(?:-(\d+))?(?::(\d+))?$/.exec(spec)
  if (!match) return "Use a port (3000), a range (3000-3010) or device:local (8080:3000)"
  const from = Number(match[1])
  const to = match[2] === undefined ? from : Number(match[2])
  const local = match[3] === undefined ? undefined : Number(match[3])
  if (!isPort(from) || !isPort(to) || (local !== undefined && !isPort(local))) return "Ports are 1–65535"
  if (to < from) return "A range goes from the lower port to the higher one"
  if (to - from >= MAX_RANGE) return `A range covers at most ${MAX_RANGE} ports`
  if (local !== undefined && to !== from) return "Map a single port to another one, not a range"
  return local === undefined || local === from ? { from, to } : { from, to, local }
}

export function formatPortRule(rule: PortRule) {
  const ports = rule.from === rule.to ? `${rule.from}` : `${rule.from}-${rule.to}`
  return rule.local === undefined ? ports : `${ports}:${rule.local}`
}

export function ruleForwards(rule: PortRule): Forward[] {
  const out: Forward[] = []
  for (let port = rule.from; port <= rule.to; port++) out.push({ device: port, local: rule.local ?? port })
  return out
}

export function expandRules(rules: PortRule[]): Forward[] {
  const seen = new Set<number>()
  const out: Forward[] = []
  for (const rule of rules) {
    for (const f of ruleForwards(rule)) {
      if (seen.has(f.device)) continue
      seen.add(f.device)
      out.push(f)
    }
  }
  return out
}

export const SKIP_HOST_KEY_CHECK = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

export function sshOptions({ port, skipHostKeyCheck }: { port: number; skipHostKeyCheck: boolean }) {
  const parts: string[] = []
  if (port !== 22) parts.push(`-p ${port}`)
  if (skipHostKeyCheck) parts.push(SKIP_HOST_KEY_CHECK)
  return parts
}

export function sshCommand({
  user,
  host,
  port,
  skipHostKeyCheck,
  forwards,
  adb,
}: {
  user: string
  host: string
  port: number
  skipHostKeyCheck: boolean
  forwards: Forward[]
  adb: boolean
}) {
  const parts = ["ssh -N", ...sshOptions({ port, skipHostKeyCheck })]
  if (adb) parts.push("-L 5555:adb:5555")
  for (const f of forwards) parts.push(`-R ${f.device}:localhost:${f.local}`)
  parts.push(`${user}@${host}`)
  return parts.join(" ")
}

function read(key: string) {
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

export function loadPortRules(): PortRule[] {
  let texts: unknown = DEFAULT_PORT_RULES
  const raw = read(rulesKey)
  if (raw !== null) {
    try {
      texts = JSON.parse(raw)
    } catch {
      texts = DEFAULT_PORT_RULES
    }
  }
  if (!Array.isArray(texts)) texts = DEFAULT_PORT_RULES
  return (texts as unknown[]).flatMap((t) => {
    const rule = typeof t === "string" ? parsePortRule(t) : "invalid"
    return typeof rule === "string" ? [] : [rule]
  })
}

export const savePortRules = (rules: PortRule[]) => write(rulesKey, JSON.stringify(rules.map(formatPortRule)))

export const loadIncludeADB = () => read(adbKey) !== "false"

export const saveIncludeADB = (on: boolean) => write(adbKey, String(on))

export const loadAllDevices = () => read(allKey) === "true"

export const saveAllDevices = (on: boolean) => write(allKey, String(on))
