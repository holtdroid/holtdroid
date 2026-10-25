import { describe, expect, test } from "bun:test"
import { bundleFormat, BundleError, openBundle, readEvents, readZipIndex } from "@/lib/recording/bundle"
import { colorLogLine } from "@/lib/recording/logfile"

const enc = new TextEncoder()

function crc32(data: Uint8Array) {
  let c = ~0
  for (const b of data) {
    c ^= b
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

type Item = { name: string; data: Uint8Array }

class Out {
  parts: Uint8Array[] = []
  length = 0
  push(...parts: Uint8Array[]) {
    for (const p of parts) {
      this.parts.push(p)
      this.length += p.length
    }
  }
  blob() {
    return new Blob(this.parts as BlobPart[])
  }
}

function bytes(size: number, fill: (v: DataView) => void) {
  const a = new Uint8Array(size)
  fill(new DataView(a.buffer))
  return a
}

/**
 * Builds a stored ZIP the way the server's writer does: sizes after the data
 * in a descriptor, or (zip64) with the 64-bit fields in the central
 * directory, whatever the real sizes are.
 */
function zip(items: Item[], opts: { zip64?: boolean; descriptor?: boolean } = {}) {
  const out = new Out()
  const central: { item: Item; offset: number }[] = []
  for (const item of items) {
    const name = enc.encode(item.name)
    const offset = out.length
    const flags = opts.descriptor ? 8 : 0
    out.push(
      bytes(30, (v) => {
        v.setUint32(0, 0x04034b50, true)
        v.setUint16(4, 20, true)
        v.setUint16(6, flags, true)
        if (!opts.descriptor) {
          v.setUint32(14, crc32(item.data), true)
          v.setUint32(18, item.data.length, true)
          v.setUint32(22, item.data.length, true)
        }
        v.setUint16(26, name.length, true)
      }),
      name,
      item.data,
    )
    if (opts.descriptor) {
      out.push(
        bytes(16, (v) => {
          v.setUint32(0, 0x08074b50, true)
          v.setUint32(4, crc32(item.data), true)
          v.setUint32(8, item.data.length, true)
          v.setUint32(12, item.data.length, true)
        }),
      )
    }
    central.push({ item, offset })
  }
  const cdStart = out.length
  for (const { item, offset } of central) {
    const name = enc.encode(item.name)
    const extra = opts.zip64
      ? bytes(12, (v) => {
          v.setUint16(0, 1, true)
          v.setUint16(2, 8, true)
          v.setBigUint64(4, BigInt(offset), true)
        })
      : new Uint8Array(0)
    out.push(
      bytes(46, (v) => {
        v.setUint32(0, 0x02014b50, true)
        v.setUint16(4, 45, true)
        v.setUint16(6, 20, true)
        v.setUint16(8, opts.descriptor ? 8 : 0, true)
        v.setUint32(16, crc32(item.data), true)
        v.setUint32(20, item.data.length, true)
        v.setUint32(24, item.data.length, true)
        v.setUint16(28, name.length, true)
        v.setUint16(30, extra.length, true)
        v.setUint32(42, opts.zip64 ? 0xffffffff : offset, true)
      }),
      name,
      extra,
    )
  }
  const cdSize = out.length - cdStart
  if (opts.zip64) {
    const rec = out.length
    out.push(
      bytes(56, (v) => {
        v.setUint32(0, 0x06064b50, true)
        v.setBigUint64(4, 44n, true)
        v.setUint16(12, 45, true)
        v.setUint16(14, 45, true)
        v.setBigUint64(24, BigInt(items.length), true)
        v.setBigUint64(32, BigInt(items.length), true)
        v.setBigUint64(40, BigInt(cdSize), true)
        v.setBigUint64(48, BigInt(cdStart), true)
      }),
      bytes(20, (v) => {
        v.setUint32(0, 0x07064b50, true)
        v.setBigUint64(8, BigInt(rec), true)
        v.setUint32(16, 1, true)
      }),
    )
  }
  out.push(
    bytes(22, (v) => {
      v.setUint32(0, 0x06054b50, true)
      v.setUint16(8, opts.zip64 ? 0xffff : items.length, true)
      v.setUint16(10, opts.zip64 ? 0xffff : items.length, true)
      v.setUint32(12, opts.zip64 ? 0xffffffff : cdSize, true)
      v.setUint32(16, opts.zip64 ? 0xffffffff : cdStart, true)
    }),
  )
  return out.blob()
}

const text = (name: string, s: string): Item => ({ name, data: enc.encode(s) })
const json = (name: string, v: unknown) => text(name, JSON.stringify(v))
const gz = (name: string, s: string): Item => ({ name, data: Bun.gzipSync(enc.encode(s)) })

const manifest = {
  state: "done",
  startedAt: "2026-10-25T12:00:00Z",
  updatedAt: "2026-10-25T12:00:10Z",
  duration: 10_000,
  size: 99,
  epochs: [],
  events: [{ file: "events-1.jsonl.gz", start: 0, end: 1000, size: 1 }],
  logcat: [{ file: "logcat-1.log.gz", start: 0, end: 1000, size: 1 }],
}

const meta = {
  format: bundleFormat,
  version: 1,
  exportedAt: "2026-10-26T00:00:00Z",
  recording: { id: "20261025T120000Z-aa", package: "com.example", label: "Shop", state: "done" },
  markers: [{ id: "m1", t: 500, label: "login", icon: "bug" as const }],
}

const items = (): Item[] => [
  json("holtdroid.json", meta),
  json("manifest.json", manifest),
  gz(
    "events-1.jsonl.gz",
    `${JSON.stringify({ t: 0, type: "info", info: { model: "Pixel" } })}\n${JSON.stringify({ t: 5, type: "key", key: "home" })}\n`,
  ),
  gz("logcat-1.log.gz", "00:00:00.100  10-25 12:00:00.100 1 1 I Tag: hi\n"),
  { name: "seg-1.m4s", data: new Uint8Array([1, 2, 3, 4, 5]) },
]

async function failure(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    return e as Error
  }
  return undefined
}

describe("readZipIndex", () => {
  for (const [label, opts] of [
    ["a plain ZIP", {}],
    ["one with data descriptors, as the server writes", { descriptor: true }],
    ["one with ZIP64 offsets", { zip64: true }],
    ["one with ZIP64 and descriptors", { zip64: true, descriptor: true }],
  ] as const) {
    test(`finds every file of ${label}`, async () => {
      const index = await readZipIndex(zip(items(), opts))
      expect([...index.keys()]).toEqual(items().map((i) => i.name))
      expect(index.get("seg-1.m4s")?.size).toBe(5)
    })

    test(`opens a recording from ${label}`, async () => {
      const b = await openBundle(zip(items(), opts))
      expect(b.recording.package).toBe("com.example")
      expect(b.recording.filesUrl).toBe("")
      expect(b.markers).toEqual(meta.markers)
      expect(b.manifest.duration).toBe(10_000)
      expect([...new Uint8Array(await b.files.bytes("seg-1.m4s"))]).toEqual([1, 2, 3, 4, 5])
      expect(await b.files.text("logcat-1.log.gz")).toContain("Tag: hi")
      const events = await readEvents(b.files, b.manifest)
      expect(events.map((e) => e.type)).toEqual(["info", "key"])
    })
  }

  test("a file that isn't a ZIP, or isn't a recording, is refused", async () => {
    expect(await failure(readZipIndex(new Blob(["not a zip at all"])))).toBeInstanceOf(BundleError)
    expect(await failure(openBundle(zip([text("readme.txt", "hi")])))).toBeInstanceOf(BundleError)
    const other = zip([json("holtdroid.json", { ...meta, format: "other" }), json("manifest.json", manifest)])
    expect((await failure(openBundle(other)))?.message).toContain("isn't a Holtdroid recording")
    const newer = zip([json("holtdroid.json", { ...meta, version: 2 }), json("manifest.json", manifest)])
    expect((await failure(openBundle(newer)))?.message).toContain("newer Holtdroid")
  })

  test("a big file is read by slices, never whole", async () => {
    class Spy extends Blob {
      reads: number[] = []
      override slice(start?: number, end?: number, type?: string) {
        this.reads.push((end ?? this.size) - (start ?? 0))
        return super.slice(start, end, type)
      }
    }
    const spy = new Spy([zip([...items(), { name: "seg-2.m4s", data: new Uint8Array(40 * 1024 * 1024) }])])
    const b = await openBundle(spy)
    await b.files.bytes("seg-1.m4s")
    expect(spy.size).toBeGreaterThan(40_000_000)
    expect(Math.max(...spy.reads)).toBeLessThan(1_000_000)
    expect(spy.reads.reduce((a, c) => a + c, 0)).toBeLessThan(1_000_000)
  })
})

test("a coloured logcat line matches what the server makes", () => {
  const line = "00:01:02.345  10-25 12:00:05.000  1234  1240 E chromium: Uncaught TypeError"
  const out = colorLogLine(line)
  expect(out).toContain("\x1b[31mUncaught TypeError")
  expect(out).toContain("\x1b[1;31mE\x1b[0m")
  expect(out).toContain("\x1b[90m00:01:02.345")
  expect(colorLogLine("-- 3 lines dropped --")).toBe("\x1b[90m-- 3 lines dropped --\x1b[0m")
})
