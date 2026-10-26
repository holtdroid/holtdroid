import { describe, expect, test } from "bun:test"
import { parseBody, parsePackets, socketIOPacket } from "@/lib/recording/body"

describe("socketIOPacket", () => {
  test.each([
    ["2", "engine.io ping", undefined],
    ["3probe", "engine.io pong probe", undefined],
    ['0{"sid":"abc","pingInterval":25000}', "engine.io open", { sid: "abc", pingInterval: 25000 }],
    ['40{"sid":"x"}', "socket.io connect", { sid: "x" }],
    ['42["message",{"text":"hi","ts":1793006807680}]', "message", { text: "hi", ts: 1793006807680 }],
    ['42/chat,17["typing","a","b"]', "typing /chat #17", ["a", "b"]],
    ["41", "socket.io disconnect", undefined],
  ])("%s", (raw, label, value) => {
    const p = socketIOPacket(raw)
    expect(p?.label).toBe(label)
    expect(p?.value).toEqual(value)
  })

  test("plain numbers and words are not packets", () => {
    for (const raw of ["42", "7", "hello", "4hello", "42[oops"]) expect(socketIOPacket(raw)).toBeNull()
  })
})

describe("parsePackets", () => {
  test("SignalR records", () => {
    const p = parsePackets(
      '{"protocol":"json","version":1}\x1e{"type":1,"target":"ReceiveMessage","arguments":["hi"]}\x1e{"type":6}\x1e',
    )
    expect(p?.kind).toBe("packets")
    if (p?.kind !== "packets") return
    expect(p.format).toBe("SignalR")
    expect(p.packets.map((x) => x.label)).toEqual(["handshake json", "invoke ReceiveMessage", "ping"])
  })

  test("Engine.IO long-polling payloads", () => {
    const p = parsePackets('40{"sid":"a"}\x1e42["tick",{"n":1}]')
    expect(p?.kind === "packets" && p.format).toBe("Engine.IO")
    expect(p?.kind === "packets" && p.packets[1]?.label).toBe("tick")
  })

  test("JSON Lines", () => {
    const p = parsePackets('{"a":1}\n{"a":2}\n')
    expect(p?.kind === "packets" && [p.format, p.packets.length]).toEqual(["JSON Lines", 2])
    expect(parsePackets('{"a":1}\nnot json')).toBeNull()
  })

  test("Server-Sent Events", () => {
    const p = parsePackets('event: update\ndata: {"v":1}\n\ndata: plain\n\n', "text/event-stream")
    expect(p?.kind).toBe("packets")
    if (p?.kind !== "packets") return
    expect(p.packets.map((x) => [x.label, x.value])).toEqual([
      ["update", { v: 1 }],
      [undefined, "plain"],
    ])
  })

  test("a single socket.io frame and plain JSON", () => {
    expect(parseBody('42["chat",{"t":1}]').kind).toBe("packets")
    expect(parseBody('{"a":1}').kind).toBe("json")
    expect(parseBody("hello").kind).toBe("text")
  })
})
