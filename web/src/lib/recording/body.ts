export type ParsedBody =
  | { kind: "json"; value: unknown }
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
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x0c && c !== 0x0b) return null
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

/** Works out what a body is: JSON, a form, text or bytes. */
export function parseBody(body: string, base64 = false, mime = ""): ParsedBody {
  let text = body
  if (base64) {
    const bytes = decodeBase64(body)
    const decoded = textOf(bytes)
    if (decoded === null) return { kind: "binary", bytes }
    text = decoded
  }
  const json = parseJSON(text)
  if (json.ok && typeof json.value === "object" && json.value !== null) return { kind: "json", value: json.value }
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
