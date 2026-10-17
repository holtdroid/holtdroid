import { Float32PlanerPcmPlayer } from "@yume-chan/pcm-player"
import { ScrcpyOptions3_3_3 } from "@yume-chan/scrcpy"
import { WritableStream } from "@yume-chan/stream-extra"
import { openSocket, socketStream } from "@/lib/scrcpy"

// Must match how the agent starts the server (internal/agent/scrcpy.go).
const options = new ScrcpyOptions3_3_3({
  video: false,
  audio: true,
  control: false,
  audioCodec: "opus",
  sendDeviceMeta: false,
})

const config: AudioDecoderConfig = { codec: "opus", sampleRate: 48000, numberOfChannels: 2 }

export class AudioUnavailableError extends Error {}

export type AudioConnection = {
  done: Promise<void>
  close: () => void
}

export async function audioSupported() {
  if (typeof AudioDecoder === "undefined" || typeof AudioWorkletNode === "undefined") return false
  return AudioDecoder.isConfigSupported(config).then(
    (r) => r.supported === true,
    () => false,
  )
}

// Call from a user gesture: the player's AudioContext is created right away
// so the browser lets it play.
export async function openAudio(url: string): Promise<AudioConnection> {
  const player = new Float32PlanerPcmPlayer(config.sampleRate, config.numberOfChannels)
  const { ws, opened } = openSocket(url)
  try {
    await opened
    const metadata = await options.parseAudioStreamMetadata(socketStream(ws))
    if (metadata.type !== "success") throw new AudioUnavailableError("This device can't capture its audio")
    await player.start()
    const decoder = new AudioDecoder({
      output: (data) => {
        const planes = Array.from({ length: data.numberOfChannels }, (_, i) => {
          const plane = new Float32Array(data.numberOfFrames)
          data.copyTo(plane, { planeIndex: i, format: "f32-planar" })
          return plane
        })
        data.close()
        player.feed(planes)
      },
      error: () => ws.close(),
    })
    decoder.configure(config)
    const done = metadata.stream
      .pipeThrough(options.createMediaStreamTransformer())
      .pipeTo(
        new WritableStream({
          write(packet) {
            if (packet.type === "configuration") return
            decoder.decode(
              new EncodedAudioChunk({ type: "key", timestamp: Number(packet.pts ?? 0n), data: packet.data }),
            )
          },
        }),
      )
      .catch(() => undefined)
      .finally(() => {
        if (decoder.state !== "closed") decoder.close()
        void player.stop()
      })
    return { done, close: () => ws.close() }
  } catch (e) {
    ws.close()
    void player.stop()
    throw e
  }
}
