import { KeyboardIcon, MonitorPlayIcon, SettingsIcon, TypeIcon, VideoIcon } from "lucide-react"
import { type LiveScreen, useDecodableCodecs, useScreenLive } from "@/components/session/live-screen"
import {
  CardLine,
  Chips,
  Note,
  Row,
  Section,
  ShadeCard,
  ShadeHeader,
  ShadePanel,
  Tile,
} from "@/components/session/shade"
import { useDevice } from "@/components/session/use-device"
import { HoverCard, HoverCardTrigger } from "@/components/ui/hover-card"
import {
  codecCost,
  defaultScreenPrefs,
  pickCodec,
  setScreenPrefs,
  streamLimits,
  useScreenPrefs,
  type VideoCodec,
} from "@/lib/screen-prefs"

const codecs: Record<VideoCodec, { label: string; hint: string }> = {
  h264: { label: "H.264", hint: "The lightest for the server to encode, works in every browser" },
  h265: { label: "H.265 (HEVC)", hint: "About a third less bandwidth for the same picture, heavier to encode" },
  av1: { label: "AV1", hint: "The least bandwidth, the heaviest to encode" },
}

const sizes = [
  { value: 0, label: "Original" },
  { value: 1920, label: "1920 px" },
  { value: 1280, label: "1280 px" },
  { value: 1024, label: "1024 px" },
  { value: 800, label: "800 px" },
]

const rates = [120, 90, 60, 30, 15]

const bitRates = [
  { value: 8_000_000, label: "8 Mbit/s" },
  { value: 4_000_000, label: "4 Mbit/s" },
  { value: 2_000_000, label: "2 Mbit/s" },
  { value: 1_000_000, label: "1 Mbit/s" },
  { value: 500_000, label: "0.5 Mbit/s" },
]

function bitRateLabel(v: number) {
  return bitRates.find((b) => b.value === v)?.label ?? `${v / 1_000_000} Mbit/s`
}

export function StreamWidget({ provider, id, live }: { provider: string; id: string; live: LiveScreen }) {
  const prefs = useScreenPrefs()
  const session = `${provider}/${id}`
  const decodable = useDecodableCodecs()
  const available = codecCost.filter((c) => !decodable?.length || decodable.includes(c))
  const codec = pickCodec(prefs.codec, decodable)
  const { maxSize, maxFps } = streamLimits(prefs, session)
  const refresh = useDevice(provider, id).data?.refreshRate ?? 0
  const fps = refresh > 0 && maxFps >= refresh ? 0 : maxFps
  const connected = useScreenLive(live)

  const fpsOptions = [
    { value: 0, label: refresh > 0 ? `${refresh} fps (device)` : "Device rate" },
    ...rates.filter((r) => refresh === 0 || r < refresh).map((r) => ({ value: r, label: `${r} fps` })),
  ]
  const size = sizes.find((s) => s.value === maxSize)?.label ?? `${maxSize} px`
  const changed =
    codec !== defaultScreenPrefs.codec || prefs.bitRate !== defaultScreenPrefs.bitRate || maxSize !== 0 || fps !== 0

  return (
    <HoverCard openDelay={150} closeDelay={200}>
      <HoverCardTrigger asChild>
        <ShadeCard aria-label="Stream and keyboard" changed={changed}>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <MonitorPlayIcon className="size-4 shrink-0 text-neutral-400" />
            <span className="truncate">{codecs[codec].label}</span>
          </span>
          <CardLine icon={VideoIcon}>
            {size} · {fps || refresh || "max"} fps
          </CardLine>
          <CardLine icon={prefs.keyboard === "uhid" ? KeyboardIcon : TypeIcon}>
            {prefs.keyboard === "uhid" ? "USB keyboard" : "Text input"}
          </CardLine>
        </ShadeCard>
      </HoverCardTrigger>
      <ShadePanel>
        <ShadeHeader
          title="Stream"
          summary={`${codecs[codec].label} · ${size} · ${fps || refresh || "max"} fps · ${bitRateLabel(prefs.bitRate)}`}
          onReset={
            changed
              ? () =>
                  setScreenPrefs({
                    codec: defaultScreenPrefs.codec,
                    bitRate: defaultScreenPrefs.bitRate,
                    maxSize: 0,
                    maxFps: 0,
                    streamFor: session,
                  })
              : undefined
          }
        />
        <Section title="Codec">
          {available.map((c) => (
            <Row
              key={c}
              selected={c === codec}
              icon={VideoIcon}
              title={codecs[c].label}
              onClick={() => setScreenPrefs({ codec: c })}
            >
              {codecs[c].hint}
            </Row>
          ))}
        </Section>
        <Chips
          title="Resolution, this session"
          options={sizes}
          value={maxSize}
          onChange={(v) => setScreenPrefs({ maxSize: v, maxFps: fps, streamFor: session })}
        />
        <Chips
          title="Frame rate, this session"
          options={fpsOptions}
          value={fps}
          onChange={(v) => setScreenPrefs({ maxFps: v, maxSize, streamFor: session })}
        />
        <Chips
          title="Bitrate"
          options={bitRates}
          value={prefs.bitRate}
          onChange={(bitRate) => setScreenPrefs({ bitRate })}
        />
        <Note>
          The codec and bitrate are remembered in this browser; resolution and frame rate start from the device&apos;s
          own in every session. Lower values help on a slow connection.
        </Note>

        <section className="grid gap-1.5">
          <h4 className="px-1 text-xs font-medium text-neutral-400">Keyboard</h4>
          <div className="grid grid-cols-2 gap-2">
            <Tile
              icon={TypeIcon}
              label="Text input"
              status="Latin letters"
              on={prefs.keyboard === "text"}
              onClick={() => setScreenPrefs({ keyboard: "text" })}
            />
            <Tile
              icon={KeyboardIcon}
              label="USB keyboard"
              status="Any layout"
              on={prefs.keyboard === "uhid"}
              onClick={() => setScreenPrefs({ keyboard: "uhid" })}
            />
          </div>
        </section>
        <Note>
          {prefs.keyboard === "text"
            ? "Typed characters are inserted as text. Only Latin characters work; for other alphabets use the USB keyboard."
            : "Android sees a USB keyboard and applies its own layout, so shortcuts and any alphabet work. Switch layouts with Ctrl+Space."}
        </Note>
        {prefs.keyboard === "uhid" && (
          <button
            type="button"
            disabled={!connected}
            className="flex items-center justify-center gap-2 rounded-full bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100 transition-colors hover:bg-neutral-700 disabled:opacity-50"
            onClick={() => live.connection?.control.keyboardSettings()}
          >
            <SettingsIcon className="size-4" />
            Keyboard layout settings
          </button>
        )}
      </ShadePanel>
    </HoverCard>
  )
}
