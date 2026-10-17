import { expect, test } from "bun:test"
import { normalizeURL } from "@/lib/cdp"

test.each([
  ["https://shop.example/cart", "https://shop.example/cart"],
  ["  shop.example/cart ", "https://shop.example/cart"],
  ["localhost:3000/app", "http://localhost:3000/app"],
  ["10.0.2.2:8080", "http://10.0.2.2:8080"],
  ["127.0.0.1", "http://127.0.0.1"],
  ["localhost.example", "https://localhost.example"],
  ["about:blank", "about:blank"],
  ["file:///sdcard/index.html", "file:///sdcard/index.html"],
  ["myapp://deep/link", "myapp://deep/link"],
])("normalizeURL(%p)", (input, want) => {
  expect(normalizeURL(input)).toBe(want)
})
