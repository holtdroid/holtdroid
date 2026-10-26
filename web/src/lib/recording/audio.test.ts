import { describe, expect, test } from "bun:test"
import type { RecordingManifest } from "@/api/client"
import { AudioPlayback, audioSegmentsOf } from "@/lib/recording/audio"

const seg = (file: string, start: number) => ({ file, start, duration: 10_000, size: 1, key: true })
const run = (init: string, ...segments: ReturnType<typeof seg>[]) => ({
  init,
  codec: "opus" as const,
  channels: 2,
  rate: 48000,
  segments,
})

describe("audioSegmentsOf", () => {
  test("joins the runs of sound in time order, each segment knowing its init", () => {
    const manifest = {
      audio: [
        run("ainit-1.mp4", seg("aseg-3.m4s", 40_000), seg("aseg-4.m4s", 50_000)),
        run("ainit-0.mp4", seg("aseg-1.m4s", 0), seg("aseg-2.m4s", 10_000)),
      ],
    } as Pick<RecordingManifest, "audio">
    expect(audioSegmentsOf(manifest).map((s) => [s.file, s.init])).toEqual([
      ["aseg-1.m4s", "ainit-0.mp4"],
      ["aseg-2.m4s", "ainit-0.mp4"],
      ["aseg-3.m4s", "ainit-1.mp4"],
      ["aseg-4.m4s", "ainit-1.mp4"],
    ])
  })

  test("a recording made before there was sound has none", () => {
    expect(audioSegmentsOf({} as Pick<RecordingManifest, "audio">)).toEqual([])
    expect(audioSegmentsOf(undefined)).toEqual([])
  })
})

describe("AudioPlayback", () => {
  const files = { bytes: async () => new ArrayBuffer(0), text: async () => "" }

  test("without sound it is not available and never opens an audio context", () => {
    const a = new AudioPlayback(files, { audio: [] })
    expect(a.available).toBe(false)
    a.start(0, 1)
    a.stop()
    a.dispose()
  })

  test("it is muted without losing its place", () => {
    const a = new AudioPlayback(files, { audio: [run("ainit-0.mp4", seg("aseg-1.m4s", 0))] })
    expect(a.available).toBe(true)
    a.setMuted(true)
    expect(a.muted).toBe(true)
    a.update({ audio: [] })
    expect(a.available).toBe(false)
  })
})
