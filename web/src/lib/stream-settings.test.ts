import { expect, test } from "bun:test"
import { defaultScreenPrefs } from "@/lib/screen-prefs"
import { pickCodec, streamSettings } from "@/lib/stream-settings"

const phone = { screenWidth: 1080, screenHeight: 2340, refreshRate: 60 }
const qhd = { screenWidth: 1440, screenHeight: 3200, refreshRate: 120 }

test("a 1080p phone streams at its own size and 45 fps", () => {
  const s = streamSettings(defaultScreenPrefs, "p/1", phone)
  expect([s.quality, s.maxSize, s.maxFps, s.changed]).toEqual([1080, 0, 45, false])
  expect(s.qualities.map((q) => q.label)).toEqual(["Original (1080p)", "720p", "480p", "360p"])
  expect(s.rates.map((r) => r.label)).toEqual(["Original (60)", "45 fps", "30 fps", "15 fps"])
})

test("a QHD 120 Hz phone is held at 1080p and 60 fps", () => {
  const s = streamSettings(
    { ...defaultScreenPrefs, ...streamSettings(defaultScreenPrefs, "p/1", qhd).setFps(60) },
    "p/1",
    qhd,
  )
  expect([s.quality, s.maxSize, s.maxFps]).toEqual([1080, 2400, 60])
  expect(s.qualities[0]?.label).toBe("1080p")
  expect(s.rates[0]?.label).toBe("60 fps")
})

test("720p on a tall phone limits the long side", () => {
  const prefs = { ...defaultScreenPrefs, ...streamSettings(defaultScreenPrefs, "p/1", phone).setQuality(720) }
  expect(streamSettings(prefs, "p/1", phone).maxSize).toBe(1560)
  expect(streamSettings(prefs, "p/2", phone).maxSize).toBe(0)
})

test("a lower frame rate carries over to the next session, a higher one doesn't", () => {
  const low = { ...defaultScreenPrefs, ...streamSettings(defaultScreenPrefs, "p/1", phone).setFps(30) }
  expect(streamSettings(low, "p/2", phone).maxFps).toBe(30)
  const high = { ...low, ...streamSettings(low, "p/1", phone).setFps(60) }
  expect(streamSettings(high, "p/1", phone).maxFps).toBe(60)
  expect(streamSettings(high, "p/2", phone).maxFps).toBe(45)
})

test("a slow display caps the default", () => {
  const s = streamSettings(defaultScreenPrefs, "p/1", { ...phone, refreshRate: 30 })
  expect([s.maxFps, s.rates.map((r) => r.value)]).toEqual([30, [30, 15]])
})

test("pickCodec falls back to the cheapest decodable codec", () => {
  expect(pickCodec("av1", ["h264", "av1"])).toBe("av1")
  expect(pickCodec("av1", ["h265"])).toBe("h265")
  expect(pickCodec("h265", undefined)).toBe("h265")
})
