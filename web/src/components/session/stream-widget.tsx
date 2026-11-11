import {
  HeadphoneOffIcon,
  HeadphonesIcon,
  KeyboardIcon,
  MonitorPlayIcon,
  SettingsIcon,
  TypeIcon,
  VideoIcon,
} from "lucide-react"
import {
  bitRate,
  type LiveScreen,
  type StreamRate,
  useDecodableCodecs,
  useScreenLive,
  useStreamRate,
} from "@/components/session/live-screen"
import {
  Chips,
  Note,
  Row,
  Section,
  ShadeCard,
  ShadeHeader,
  ShadePanel,
  Tile,
  ShadeRoot,
} from "@/components/session/shade"
import { useDeviceAudio } from "@/components/session/device-audio"
import { useDevice } from "@/components/session/use-device"
import { cn } from "@/lib/utils"
import { defaultScreenPrefs, setScreenPrefs, useScreenPrefs, type VideoCodec } from "@/lib/screen-prefs"
import { codecCost, pickCodec, streamSettings } from "@/lib/stream-settings"

const codecs: Record<VideoCodec, { label: string; hint: string }> = {
  h264: { label: "H.264", hint: "The lightest for the server to encode, works in every browser" },
  h265: { label: "H.265 (HEVC)", hint: "About a third less bandwidth for the same picture, heavier to encode" },
  av1: { label: "AV1", hint: "The least bandwidth, the heaviest to encode" },
}

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
  const st = streamSettings(prefs, session, useDevice(provider, id).data)
  const connected = useScreenLive(live)
  const rate = useStreamRate(live)
  const audio = useDeviceAudio(provider, id, live)

  const size = `${st.quality}p`
  const changed =
    (audio.supported && !audio.wanted) ||
    codec !== defaultScreenPrefs.codec ||
    prefs.bitRate !== defaultScreenPrefs.bitRate ||
    st.changed

  return (
    <ShadeRoot>
      <ShadeCard
        title="Stream"
        aria-label="Stream and keyboard"
        icon={MonitorPlayIcon}
        changed={changed}
        summary={
          audio.waitingForClick ? (
            <span className="text-warning">Click anywhere for sound</span>
          ) : (
            [
              codecs[codec].label,
              `${size} · ${st.maxFps} fps`,
              rate && `${rate.fps.toFixed(0)} fps · ${bitRate(rate.bitrate)}`,
              prefs.keyboard === "uhid" ? "USB keyboard" : "text input",
            ]
              .filter(Boolean)
              .join(" · ")
          )
        }
      />
      <ShadePanel>
        <ShadeHeader
          title="Stream"
          summary={`${codecs[codec].label} · ${st.qualityLabel} · ${st.maxFps} fps · ${bitRateLabel(prefs.bitRate)}`}
          onReset={
            changed
              ? () =>
                  setScreenPrefs({
                    codec: defaultScreenPrefs.codec,
                    bitRate: defaultScreenPrefs.bitRate,
                    audio: defaultScreenPrefs.audio,
                    ...st.reset(),
                  })
              : undefined
          }
        />
        {rate && <LiveStats rate={rate} />}
        <Tile
          icon={audio.on ? HeadphonesIcon : HeadphoneOffIcon}
          label="Device audio"
          status={audio.status}
          on={audio.on}
          wide
          disabled={!audio.supported}
          onClick={() => audio.setOn(!audio.on)}
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
          title="Quality, this session"
          options={st.qualities}
          value={st.quality}
          onChange={(v) => setScreenPrefs(st.setQuality(v))}
        />
        <Chips title="Frame rate" options={st.rates} value={st.maxFps} onChange={(v) => setScreenPrefs(st.setFps(v))} />
        <Chips
          title="Bitrate"
          options={bitRates}
          value={prefs.bitRate}
          onChange={(v) => setScreenPrefs({ bitRate: v })}
        />
        <Note>
          The stream is never sharper than 1080p or faster than 60 fps. The codec and bitrate are remembered in this
          browser, and so is a frame rate below {st.startFps} fps; quality and faster frame rates last for this session
          only. Lower values help on a slow connection.
        </Note>

        <section className="grid gap-1.5">
          <h4 className="px-1 text-xs font-medium text-muted-foreground">Keyboard</h4>
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
            className="flex items-center justify-center gap-2 rounded-full bg-muted px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            onClick={() => live.connection?.control.keyboardSettings()}
          >
            <SettingsIcon className="size-4" />
            Keyboard layout settings
          </button>
        )}
      </ShadePanel>
    </ShadeRoot>
  )
}

function LiveStats({ rate }: { rate: StreamRate }) {
  return (
    <section className="grid gap-1.5">
      <h4 className="px-1 text-xs font-medium text-muted-foreground">Right now, in this browser</h4>
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Frames shown" value={`${rate.fps.toFixed(0)} fps`} />
        <Stat label="Bitrate" value={bitRate(rate.bitrate)} />
        <Stat label="Dropped" value={String(rate.dropped)} warn={rate.dropped > 0} />
      </div>
      <Note>The device only sends frames when the screen changes, so a still screen shows few of them.</Note>
    </section>
  )
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="grid gap-0.5 rounded-2xl bg-muted px-3 py-2">
      <span className={cn("text-sm font-medium tabular-nums", warn && "text-warning")}>{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  )
}
