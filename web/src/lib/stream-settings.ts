import type { ScreenPrefs, VideoCodec } from "@/lib/screen-prefs"

export const codecCost: VideoCodec[] = ["h264", "h265", "av1"]
export const qualityCap = 1080
export const fpsCap = 60
export const defaultFps = 45

const qualitySteps = [1080, 720, 480, 360]
const fpsSteps = [45, 30, 15]

export type Option = { value: number; label: string }

type Screen = { screenWidth: number; screenHeight: number; refreshRate: number }

export function pickCodec(preferred: VideoCodec, decodable?: VideoCodec[]) {
  if (!decodable || decodable.includes(preferred)) return preferred
  return codecCost.find((c) => decodable.includes(c)) ?? "h264"
}

export function streamSettings(prefs: ScreenPrefs, session: string, screen?: Screen) {
  const own = prefs.streamFor === session
  const short = screen ? Math.min(screen.screenWidth, screen.screenHeight) : 0
  const long = screen ? Math.max(screen.screenWidth, screen.screenHeight) : 0
  const topQuality = short > 0 ? Math.min(short, qualityCap) : qualityCap
  const quality = Math.min(own && prefs.quality > 0 ? prefs.quality : topQuality, topQuality)
  const maxSize = short > 0 && quality < short ? Math.round((quality * long) / short) : 0

  const refresh = screen?.refreshRate ?? 0
  const topFps = refresh > 0 ? Math.min(refresh, fpsCap) : fpsCap
  const startFps = Math.min(defaultFps, topFps)
  const wanted = own && prefs.maxFps > 0 ? prefs.maxFps : prefs.lowFps > 0 ? prefs.lowFps : startFps
  const maxFps = Math.min(wanted, topFps)

  const qualities: Option[] = [
    { value: topQuality, label: short > 0 && short <= qualityCap ? `Original (${short}p)` : `${topQuality}p` },
    ...qualitySteps.filter((q) => q < topQuality).map((q) => ({ value: q, label: `${q}p` })),
  ]
  const rates: Option[] = [
    { value: topFps, label: refresh > 0 && refresh <= fpsCap ? `Original (${topFps})` : `${topFps} fps` },
    ...fpsSteps.filter((r) => r < topFps).map((r) => ({ value: r, label: `${r} fps` })),
  ]

  return {
    quality,
    topQuality,
    qualityLabel: qualities.find((q) => q.value === quality)?.label ?? `${quality}p`,
    maxSize,
    maxFps,
    startFps,
    qualities,
    rates,
    changed: quality !== topQuality || maxFps !== startFps,
    setQuality: (q: number): Partial<ScreenPrefs> => ({ quality: q, maxFps, streamFor: session }),
    setFps: (fps: number): Partial<ScreenPrefs> => ({
      maxFps: fps,
      quality,
      streamFor: session,
      lowFps: fps < startFps ? fps : 0,
    }),
    reset: (): Partial<ScreenPrefs> => ({ quality: topQuality, maxFps: startFps, lowFps: 0, streamFor: session }),
  }
}
