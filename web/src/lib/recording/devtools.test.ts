import { describe, expect, test } from "bun:test"
import type { DevToolsEntry } from "@/api/client"
import { hexDump, parseBody } from "@/lib/recording/body"
import {
  curlOf,
  DevToolsLog,
  fetchOf,
  localScheme,
  framesUntil,
  requestPhase,
  socketAt,
  toHar,
} from "@/lib/recording/devtools"

const entries: DevToolsEntry[] = [
  { t: 0, type: "page", target: "P1", page: { url: "https://shop.example/", title: "Shop" } },
  {
    t: 900,
    type: "request",
    target: "P1",
    request: {
      id: "2",
      start: 700,
      response: 800,
      end: 900,
      method: "GET",
      url: "https://api.example/cart?id=7",
      status: 500,
      responseHeaders: { "content-type": "application/json" },
      body: '{"error":"boom"}',
      mimeType: "application/json",
      timing: { blocked: 1, dns: -1, connect: -1, ssl: -1, send: 1, wait: 90, receive: 8 },
    },
  },
  {
    t: 400,
    type: "request",
    target: "P1",
    request: {
      id: "1",
      start: 100,
      end: 400,
      method: "POST",
      url: "https://api.example/login",
      status: 200,
      postData: "a=1&b=2",
    },
  },
  { t: 300, type: "console", target: "P1", console: { source: "console", level: "error", text: "oops" } },
  { t: 200, type: "socket", target: "P1", socket: { id: "s1", url: "wss://rt.example/", state: "open" } },
  { t: 250, type: "frame", target: "P1", frame: { socket: "s1", opcode: 1, size: 4, data: "ping", sent: true } },
  {
    t: 2000,
    type: "socket",
    target: "P1",
    socket: { id: "s1", url: "wss://rt.example/", state: "closed", frames: 1, bytes: 4 },
  },
]

describe("DevToolsLog", () => {
  const log = new DevToolsLog(entries)

  test("requests are in the order they were sent, up to a time", () => {
    expect(log.requests.map((r) => r.id)).toEqual(["1", "2"])
    expect(log.requestsUntil(150).map((r) => r.id)).toEqual(["1"])
    expect(log.consoleUntil(299)).toHaveLength(0)
    expect(log.pageAt("P1", 500)?.title).toBe("Shop")
  })

  test("a request is pending until it ends", () => {
    const r = log.requests[1]!
    expect(requestPhase(r, 850)).toBe("pending")
    expect(requestPhase(r, 900)).toBe("server-error")
    expect(requestPhase({ ...r, error: "net::ERR_FAILED", status: undefined }, 900)).toBe("failed")
    expect(requestPhase({ ...r, status: 404, error: "net::ERR_ABORTED" }, 900)).toBe("client-error")
    expect(requestPhase({ ...r, error: "net::ERR_ABORTED", canceled: true }, 900)).toBe("failed")
  })

  test("sockets keep their states and frames", () => {
    const s = log.sockets[0]!
    expect(socketAt(s, 1000)?.state).toBe("open")
    expect(socketAt(s, 3000)?.state).toBe("closed")
    expect(framesUntil(s, 249)).toHaveLength(0)
    expect(framesUntil(s, 250)).toHaveLength(1)
  })

  test("HAR has every request and the WebSocket's messages", () => {
    const har = toHar(log, Date.UTC(2026, 9, 26, 12), { name: "Holtdroid", version: "1" }).log
    expect(har.version).toBe("1.2")
    expect(har.pages[0]?.title).toBe("Shop")
    const [login, ws, cart] = har.entries as Record<string, any>[]
    expect(login!.startedDateTime).toBe("2026-10-26T12:00:00.100Z")
    expect(login!.request.postData.text).toBe("a=1&b=2")
    expect(ws!._resourceType).toBe("websocket")
    expect(ws!._webSocketMessages).toEqual([
      { type: "send", time: Date.UTC(2026, 9, 26, 12, 0, 0, 250) / 1000, opcode: 1, data: "ping" },
    ])
    expect(cart!.request.queryString).toEqual([{ name: "id", value: "7" }])
    expect(cart!.response.content.text).toBe('{"error":"boom"}')
    expect(cart!.time).toBe(100)
  })

  test("fetch() keeps the headers a page may set", () => {
    const f = fetchOf({
      ...log.requests[0]!,
      requestHeaders: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: "a=1",
        Referer: "https://shop.example/",
        Host: "api.example",
      },
    })
    expect(f).toBe(
      `fetch("https://api.example/login", ${JSON.stringify(
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          referrer: "https://shop.example/",
          body: "a=1&b=2",
          method: "POST",
          mode: "cors",
          credentials: "include",
        },
        null,
        2,
      )});`,
    )
    expect(localScheme("blob:https://example.com/9e8f")).toBe("blob")
    expect(localScheme("https://example.com/")).toBeUndefined()
  })

  test("cURL quotes what the shell would break", () => {
    expect(curlOf({ ...log.requests[0]!, postData: "it's" })).toBe(
      "curl 'https://api.example/login' \\\n  -X POST \\\n  --data-raw 'it'\\''s'",
    )
  })
})

describe("parseBody", () => {
  test("JSON, forms, text and bytes", () => {
    expect(parseBody('{"a":[1,2]}')).toEqual({ kind: "json", value: { a: [1, 2] } })
    expect(parseBody("a=1&b=x%20y")).toEqual({
      kind: "form",
      pairs: [
        ["a", "1"],
        ["b", "x y"],
      ],
    })
    expect(parseBody("hello")).toEqual({ kind: "text", text: "hello" })
    expect(parseBody(btoa('{"ok":true}'), true).kind).toBe("json")
    expect(parseBody(btoa("\x00\x01\x02binary"), true).kind).toBe("binary")
  })

  test("hex dump", () => {
    expect(hexDump(new Uint8Array([0x48, 0x69, 0x00]))).toBe(
      `00000000  48 69 00${" ".repeat(15)}  ${" ".repeat(23)}  Hi.`,
    )
  })
})
