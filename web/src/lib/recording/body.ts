/** One message of a framed protocol, with its value when it carries JSON. */
export type Packet = { raw: string; label?: string; value?: unknown; json: boolean }

export type ParsedBody =
  | { kind: "json"; value: unknown }
  | { kind: "packets"; format: string; packets: Packet[] }
  | { kind: "form"; pairs: [string, string][] }
  | { kind: "text"; text: string }
  | { kind: "binary"; bytes: Uint8Array }

export function decodeBase64(s: string) {
  try {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return new Uint8Array()
  }
}

/** The bytes as text when they are valid UTF-8 without control characters. */
export function textOf(bytes: Uint8Array) {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x0c && c !== 0x0b && c !== 0x1e) return null
  }
  return text
}

export function parseJSON(text: string): { ok: true; value: unknown } | { ok: false } {
  const s = text.trim()
  if (!(s.startsWith("{") || s.startsWith("[") || s.startsWith('"'))) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(s) }
  } catch {
    return { ok: false }
  }
}

const isStructure = (v: unknown) => typeof v === "object" && v !== null

const engineTypes = ["open", "close", "ping", "pong", "message", "upgrade", "noop"]
const socketTypes = ["connect", "disconnect", "event", "ack", "connect error", "binary event", "binary ack"]
const enginePacket = /^([0-6])(.*)$/s
const socketPacket = /^([0-6])(?:\d+-)?(\/[^,]*,)?(\d*)(.*)$/s

/** An Engine.IO packet, or a Socket.IO one inside a message: `2`, `40{…}`, `42["event",{…}]`. */
export function socketIOPacket(text: string): Packet | null {
  const e = enginePacket.exec(text)
  if (!e) return null
  const [, type, rest] = e as unknown as [string, string, string]
  if (type !== "4") {
    if (rest === "" || rest === "probe")
      return { raw: text, label: `engine.io ${engineTypes[Number(type)]}${rest ? " probe" : ""}`, json: false }
    const v = parseJSON(rest)
    return v.ok && isStructure(v.value)
      ? { raw: text, label: `engine.io ${engineTypes[Number(type)]}`, value: v.value, json: true }
      : null
  }
  const m = socketPacket.exec(rest)
  if (!m) return null
  const [, st, nsp, ack, data] = m as unknown as [string, string, string | undefined, string, string]
  const where = nsp && nsp !== "/," ? ` ${nsp.slice(0, -1)}` : ""
  const kind = socketTypes[Number(st)]!
  if (data === "" && st !== "0" && st !== "1") return null
  if (data === "") return { raw: text, label: `socket.io ${kind}${where}${ack ? ` #${ack}` : ""}`, json: false }
  const v = parseJSON(data)
  if (!v.ok || !isStructure(v.value)) return null
  const event = (st === "2" || st === "5") && Array.isArray(v.value) && typeof v.value[0] === "string" ? v.value[0] : ""
  return {
    raw: text,
    label: event ? `${event}${where}${ack ? ` #${ack}` : ""}` : `socket.io ${kind}${where}${ack ? ` #${ack}` : ""}`,
    value: event && Array.isArray(v.value) ? (v.value.length === 2 ? v.value[1] : v.value.slice(1)) : v.value,
    json: true,
  }
}

const signalRTypes: Record<number, string> = {
  1: "invocation",
  2: "stream item",
  3: "completion",
  4: "stream invocation",
  5: "cancel",
  6: "ping",
  7: "close",
}

function jsonPacket(text: string): Packet | null {
  const v = parseJSON(text)
  return v.ok && isStructure(v.value) ? { raw: text, value: v.value, json: true } : null
}

/**
 * Finds the framing of a text message or body: JSON, records split by \x1e
 * (SignalR, Engine.IO polling), JSON Lines, Server-Sent Events or a Socket.IO
 * packet.
 */
export function parsePackets(text: string, mime = ""): ParsedBody | null {
  const json = parseJSON(text)
  if (json.ok && isStructure(json.value)) return { kind: "json", value: json.value }
  if (text.includes("\x1e")) {
    const parts = text.split("\x1e").filter((p) => p !== "")
    const packets = parts.map((p) => jsonPacket(p) ?? socketIOPacket(p) ?? { raw: p, json: false })
    if (packets.some((p) => p.json)) {
      const signalR = packets.every(
        (p) => !p.json || typeof (p.value as { type?: unknown }).type === "number" || "protocol" in (p.value as object),
      )
      if (signalR) {
        for (const p of packets) {
          const v = p.value as { type?: number; target?: string; protocol?: string } | undefined
          if (!v) continue
          p.label = v.protocol
            ? `handshake ${v.protocol}`
            : v.type === 1 && v.target
              ? `invoke ${v.target}`
              : signalRTypes[v.type ?? 0]
        }
      }
      return { kind: "packets", format: signalR ? "SignalR" : "Engine.IO", packets }
    }
  }
  if (
    /text\/event-stream/i.test(mime) ||
    (/^(?:data|event|id|retry):/m.test(text.trimStart().slice(0, 200)) && /^data:/m.test(text))
  ) {
    const packets: Packet[] = []
    for (const block of text.split(/\r?\n\r?\n/)) {
      if (!block.trim()) continue
      let event = ""
      const data: string[] = []
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""))
        else if (line.startsWith("event:")) event = line.slice(6).trim()
      }
      const raw = data.join("\n")
      const v = parseJSON(raw)
      packets.push({ raw: block, label: event || undefined, value: v.ok ? v.value : raw, json: v.ok })
    }
    if (packets.length > 0) return { kind: "packets", format: "Server-Sent Events", packets }
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "")
  if (lines.length >= 2 || /x-ndjson|jsonl|json-seq/i.test(mime)) {
    const packets = lines.map((l) => jsonPacket(l.startsWith("\x1e") ? l.slice(1) : l))
    if (packets.length > 0 && packets.every(Boolean))
      return { kind: "packets", format: "JSON Lines", packets: packets as Packet[] }
  }
  const io = socketIOPacket(text.trim())
  if (io)
    return { kind: "packets", format: io.label?.startsWith("engine.io") ? "Engine.IO" : "Socket.IO", packets: [io] }
  return null
}

/** Works out what a body or a message is: JSON or a framed protocol, a form, text or bytes. */
export function parseBody(body: string, base64 = false, mime = ""): ParsedBody {
  let text = body
  if (base64) {
    const bytes = decodeBase64(body)
    const decoded = textOf(bytes)
    if (decoded === null) return { kind: "binary", bytes }
    text = decoded
  }
  const framed = parsePackets(text, mime)
  if (framed) return framed
  if (/x-www-form-urlencoded/i.test(mime) || /^[\w.%[\]-]+=[^&\s]*(&[\w.%[\]-]+=[^&\s]*)+$/.test(text.trim())) {
    try {
      return { kind: "form", pairs: [...new URLSearchParams(text.trim())] }
    } catch {
      return { kind: "text", text }
    }
  }
  return { kind: "text", text }
}

/** Offset, hex and printable columns, 16 bytes a line. */
export function hexDump(bytes: Uint8Array, limit = 4096) {
  const lines: string[] = []
  const end = Math.min(bytes.length, limit)
  for (let off = 0; off < end; off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, end))
    const hex = [...row].map((b) => b.toString(16).padStart(2, "0"))
    const left = hex.slice(0, 8).join(" ")
    const right = hex.slice(8).join(" ")
    const ascii = [...row].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("")
    lines.push(`${off.toString(16).padStart(8, "0")}  ${left.padEnd(23)}  ${right.padEnd(23)}  ${ascii}`)
  }
  return lines.join("\n")
}
