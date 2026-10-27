import { expect, test } from "bun:test"
import { parseView, viewHash } from "@/lib/recording/link"

test("a view goes into a hash and back", () => {
  const view = { t: 46175, tab: "sockets" as const, socket: "79BD/2478.8", frame: "f12", request: "dropped" }
  const hash = viewHash(view)
  expect(hash).toBe("#t=46.2&tab=sockets&socket=79BD%2F2478.8&frame=f12")
  expect(parseView(hash)).toEqual({ t: 46200, tab: "sockets", socket: "79BD/2478.8", frame: "f12" })
})

test("times like YouTube's", () => {
  expect(parseView("#t=1m20s").t).toBe(80_000)
  expect(parseView("t=1h2m3.5s").t).toBe(3_723_500)
  expect(parseView("#t=80").t).toBe(80_000)
  expect(parseView("#t=soon&tab=nope")).toEqual({})
})

test("a route opens on the Routes tab", () => {
  const hash = viewHash({ t: 1000, tab: "routes", route: "api.example.com", request: "r1" })
  expect(hash).toBe("#t=1&tab=routes&route=api.example.com")
  expect(parseView(hash)).toEqual({ t: 1000, tab: "routes", route: "api.example.com" })
})

test("a cache finding stays only with its tab", () => {
  const hash = viewHash({ t: 1000, tab: "cache", finding: "buster:GET https://a.example/x", request: "P1/r1" })
  expect(hash).toBe("#t=1&tab=cache&finding=buster%3AGET+https%3A%2F%2Fa.example%2Fx")
  expect(parseView(hash)).toEqual({ t: 1000, tab: "cache", finding: "buster:GET https://a.example/x" })
})

test("images and SVG findings stay with their tabs", () => {
  expect(parseView(viewHash({ tab: "images", finding: "oversized:https://a.example/a.png", socket: "s" }))).toEqual({
    tab: "images",
    finding: "oversized:https://a.example/a.png",
  })
  expect(parseView(viewHash({ tab: "svg", finding: "duplicate" }))).toEqual({ tab: "svg", finding: "duplicate" })
})
