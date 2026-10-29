import { describe, expect, test } from "bun:test"
import { abiRank, bestVariant, groupVariants, variantsOf } from "@/lib/abi"

const build = (
  id: string,
  abis: string[],
  title = "Chrome 156",
  versionName = "156.0.8078.73",
  source = "apkmirror",
) => ({
  source,
  id,
  meta: { title },
  app: { package: "com.android.chrome", versionName, abis },
})

const emulator = ["x86_64", "x86", "arm64-v8a"]
const phone = ["arm64-v8a", "armeabi-v7a", "armeabi"]

describe("abiRank", () => {
  test.each([
    [["x86"], emulator, 1],
    [["arm64-v8a"], emulator, 2],
    [["arm64-v8a"], phone, 0],
    [["x86", "x86_64"], phone, Infinity],
    [[], phone, 0],
    [["mips"], undefined, 0],
  ])("%p on %p", (abis, device, want) => {
    expect(abiRank(build("a", abis), device)).toBe(want)
  })
})

describe("groupVariants", () => {
  test("builds of one version that differ in ABIs go together", () => {
    const x86 = build("x86", ["x86"])
    const arm = build("arm", ["arm64-v8a"])
    const arm155 = build("arm155", ["arm64-v8a"], "Chrome 155", "155.0.8059.84")
    const again = build("again", ["x86"])
    const other = build("other", ["arm64-v8a"], "Chrome 156", "156.0.8078.73", "uploads")
    const plain = build("plain", [])
    expect(groupVariants([x86, arm, arm155, again, other, plain])).toEqual([
      [x86, arm],
      [arm155],
      [again],
      [other],
      [plain],
    ])
    expect(variantsOf([x86, arm, arm155], arm)).toEqual([x86, arm])
    expect(variantsOf([x86], arm)).toEqual([arm])
  })

  test("the title wins over the version name", () => {
    const x86 = build("x86", ["x86"], "Chrome 156", "156.0.8078.73")
    const arm = build("arm", ["arm64-v8a"], "Chrome 156", "156.0.8078.80")
    expect(groupVariants([x86, arm])).toEqual([[x86, arm]])
  })
})

describe("bestVariant", () => {
  const x86 = build("x86", ["x86"])
  const arm = build("arm", ["arm64-v8a"])
  test.each([
    [emulator, x86],
    [phone, arm],
    [undefined, x86],
  ])("on %p", (device, want) => {
    expect(bestVariant([x86, arm], device)).toBe(want)
  })
  test("nothing runs", () => {
    expect(bestVariant([x86], phone)).toBeUndefined()
  })
  test("translation only when the app has no native build", () => {
    const arm157 = build("arm157", ["arm64-v8a"], "Chrome 157")
    expect(bestVariant([arm157], emulator, [x86, arm, arm157])).toBeUndefined()
    expect(bestVariant([arm157], emulator, [arm157])).toBe(arm157)
    expect(bestVariant([arm157], phone, [x86, arm, arm157])).toBe(arm157)
    const plain = build("plain", [])
    expect(bestVariant([plain], emulator, [x86, plain])).toBe(plain)
  })
})
