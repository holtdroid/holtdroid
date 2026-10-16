const KEY_TYPES: Record<string, string> = {
  "ssh-ed25519": "ED25519",
  "sk-ssh-ed25519@openssh.com": "ED25519-SK",
  "ecdsa-sha2-nistp256": "ECDSA P-256",
  "ecdsa-sha2-nistp384": "ECDSA P-384",
  "ecdsa-sha2-nistp521": "ECDSA P-521",
  "sk-ecdsa-sha2-nistp256@openssh.com": "ECDSA-SK",
  "ssh-rsa": "RSA",
}

export const MIN_RSA_BITS = 2048

export type ParsedKey = {
  type: string
  blob: string
  comment: string
  bits?: number
  line: string
}

export type KeyParseResult = { ok: true; key: ParsedKey } | { ok: false; error: string }

export function keyLabel(type: string, bits?: number) {
  const label = KEY_TYPES[type] ?? type
  return bits ? `${label} ${bits}` : label
}

function decodeBase64(text: string) {
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

function readField(bytes: Uint8Array, offset: number) {
  if (offset + 4 > bytes.length) return null
  const len = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0)
  const end = offset + 4 + len
  if (end > bytes.length) return null
  return { value: bytes.subarray(offset + 4, end), next: end }
}

function bitLength(n: Uint8Array) {
  let i = 0
  while (i < n.length && n[i] === 0) i++
  if (i === n.length) return 0
  return (n.length - i - 1) * 8 + Math.floor(Math.log2(n[i]!)) + 1
}

const fail = (error: string): KeyParseResult => ({ ok: false, error })

export function parsePublicKey(input: string): KeyParseResult {
  const text = input.trim()
  if (!text) return fail("Paste a public key")
  if (text.includes("PRIVATE KEY")) return fail("This is a private key — never share it. Use the .pub file instead.")
  if (text.split(/\r?\n/).filter((l) => l.trim()).length > 1) return fail("Add one key at a time")

  const [type = "", data, ...rest] = text.split(/\s+/)
  if (!data) return fail("Not an OpenSSH public key — expected “type key [comment]”")
  if (!(type in KEY_TYPES)) {
    return fail(`Unsupported key type “${type.slice(0, 40)}” — use ed25519, ECDSA or RSA`)
  }
  const bytes = decodeBase64(data)
  const header = bytes && readField(bytes, 0)
  if (!bytes || !header || new TextDecoder().decode(header.value) !== type) {
    return fail("The key data is damaged or doesn't match its type")
  }

  let bits: number | undefined
  if (type === "ssh-rsa") {
    const e = readField(bytes, header.next)
    const n = e && readField(bytes, e.next)
    if (!n) return fail("The key data is damaged or doesn't match its type")
    bits = bitLength(n.value)
    if (bits < MIN_RSA_BITS) return fail(`RSA keys need at least ${MIN_RSA_BITS} bits, this one has ${bits}`)
  }

  const comment = rest.join(" ")
  return {
    ok: true,
    key: { type, blob: data, comment, bits, line: comment ? `${type} ${data} ${comment}` : `${type} ${data}` },
  }
}

export async function fingerprint(blob: string) {
  const bytes = decodeBase64(blob)
  if (!bytes || !crypto.subtle) return ""
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return `SHA256:${btoa(String.fromCharCode(...digest)).replace(/=+$/, "")}`
}
