import { describe, expect, test } from "bun:test"
import { needsAndroid, newestRunnable, parsePackage, parseProps, parseWebView } from "@/lib/android"

describe("parsePackage", () => {
  test("version and runtime permissions", () => {
    const out = `Packages:
  Package [com.example.shop] (5c2b1f0):
    appId=10234
    versionCode=4210 minSdk=24 targetSdk=35
    versionName=4.2.1
    firstInstallTime=2026-10-17 07:00:00
    lastUpdateTime=2026-10-17 07:05:00
    install permissions:
      android.permission.INTERNET: granted=true
    User 0: ceDataInode=8213 installed=true
      runtime permissions:
        android.permission.CAMERA: granted=false, flags=[ USER_SENSITIVE_WHEN_GRANTED]
        android.permission.POST_NOTIFICATIONS: granted=true, flags=[ ]
      disabledComponents:
        com.example.shop.Foo
`
    expect(parsePackage(out)).toEqual({
      versionName: "4.2.1",
      versionCode: "4210",
      targetSdk: "35",
      firstInstallTime: "2026-10-17 07:00:00",
      lastUpdateTime: "2026-10-17 07:05:00",
      permissions: [
        { name: "android.permission.CAMERA", granted: false },
        { name: "android.permission.POST_NOTIFICATIONS", granted: true },
      ],
    })
  })

  test("no runtime permissions", () => {
    expect(parsePackage("Unable to find package: x\n").permissions).toEqual([])
  })
})

test("parseWebView", () => {
  const out = `Current WebView Update Service state
  Current WebView package (name, version): (com.google.android.webview, 142.0.7444.48)
  WebView packages:
    Valid package com.google.android.webview (versionName: 142.0.7444.48, versionCode: 744404833, targetSdkVersion: 35) is  installed/enabled for all users
    Valid package com.android.chrome (versionName: 141.0.7390.122, versionCode: 739012233, targetSdkVersion: 35) is  installed/enabled for all users
    Invalid package com.chrome.beta (versionName: 1.0, versionCode: 1, targetSdkVersion: 30), reason: SDK version too low
`
  expect(parseWebView(out)).toEqual({
    current: { pkg: "com.google.android.webview", version: "142.0.7444.48" },
    valid: [
      { pkg: "com.google.android.webview", version: "142.0.7444.48" },
      { pkg: "com.android.chrome", version: "141.0.7390.122" },
    ],
  })
})

test("parseProps", () => {
  expect(parseProps("[ro.product.model]: [Pixel 9]\n[ro.empty]: []\nnoise\n")).toEqual({
    "ro.product.model": "Pixel 9",
    "ro.empty": "",
  })
})

test("needsAndroid", () => {
  expect(needsAndroid(35)).toBe("Needs Android 15 or newer (API level 35)")
  expect(needsAndroid(32)).toBe("Needs Android 13 or newer (API level 32)")
  expect(needsAndroid(40)).toBe("Needs Android API level 40")
})

const build = (id: string, pkg: string, versionCode: number, minSdk: number) => ({
  id,
  minSdk,
  app: { package: pkg, versionCode },
})

test("newestRunnable", () => {
  const builds: { id: string; minSdk?: number; app?: { package: string; versionCode?: number } }[] = [
    build("new", "com.android.chrome", 156, 34),
    build("mid", "com.android.chrome", 140, 33),
    build("old", "com.android.chrome", 120, 30),
    build("other", "com.example.shop", 999, 21),
    { id: "parsing" },
  ]
  expect(newestRunnable(builds, "com.android.chrome", 33)?.id).toBe("mid")
  expect(newestRunnable(builds, "com.android.chrome", 31)?.id).toBe("old")
  expect(newestRunnable(builds, "com.android.chrome", 35)?.id).toBe("new")
  expect(newestRunnable(builds, "com.android.chrome", 29)).toBeUndefined()
  expect(newestRunnable(builds, "com.android.chrome", undefined)).toBeUndefined()

  const variants = [
    { id: "x86", app: { package: "com.android.chrome", versionCode: 306, abis: ["x86"] } },
    { id: "arm", app: { package: "com.android.chrome", versionCode: 304, abis: ["arm64-v8a"] } },
  ]
  expect(newestRunnable(variants, "com.android.chrome", 34)?.id).toBe("x86")
  expect(newestRunnable(variants, "com.android.chrome", 34, ["arm64-v8a", "armeabi-v7a"])?.id).toBe("arm")
  expect(newestRunnable(variants, "com.android.chrome", 34, ["mips"])).toBeUndefined()
})
