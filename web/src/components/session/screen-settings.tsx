import { KeyboardIcon, MonitorCogIcon } from "lucide-react"
import type { ReactNode } from "react"
import { type LiveScreen, useDecodableCodecs, useScreenLive } from "@/components/session/live-screen"
import { RailButton } from "@/components/session/rail-item"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  defaultScreenPrefs,
  type KeyboardMode,
  setScreenPrefs,
  useScreenPrefs,
  type VideoCodec,
} from "@/lib/screen-prefs"

const codecLabels: Record<VideoCodec, string> = { h264: "H.264", h265: "H.265 (HEVC)", av1: "AV1" }

const sizes = [
  { value: 0, label: "Original" },
  { value: 1920, label: "1920 px" },
  { value: 1280, label: "1280 px" },
  { value: 1024, label: "1024 px" },
  { value: 800, label: "800 px" },
]

const rates = [60, 30, 15]

const bitRates = [
  { value: 8_000_000, label: "8 Mbit/s" },
  { value: 4_000_000, label: "4 Mbit/s" },
  { value: 2_000_000, label: "2 Mbit/s" },
  { value: 1_000_000, label: "1 Mbit/s" },
  { value: 500_000, label: "0.5 Mbit/s" },
]

export function ScreenSettings({ live }: { live: LiveScreen }) {
  const prefs = useScreenPrefs()
  const connected = useScreenLive(live)
  const codecs = useDecodableCodecs()
  const available = codecs?.length ? codecs : (["h264"] as VideoCodec[])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <RailButton label="Stream and keyboard">
          <MonitorCogIcon />
        </RailButton>
      </PopoverTrigger>
      <PopoverContent side="left" align="end" className="grid w-80 gap-4">
        <div className="grid gap-3">
          <p className="text-sm font-medium">Stream</p>
          <Row label="Codec">
            <PrefSelect
              value={available.includes(prefs.codec) ? prefs.codec : "h264"}
              options={available.map((c) => ({ value: c, label: codecLabels[c] }))}
              onChange={(codec) => setScreenPrefs({ codec })}
            />
          </Row>
          <Row label="Resolution">
            <PrefSelect
              value={String(prefs.maxSize)}
              options={sizes.map((s) => ({ value: String(s.value), label: s.label }))}
              onChange={(v) => setScreenPrefs({ maxSize: Number(v) })}
            />
          </Row>
          <Row label="Frame rate">
            <PrefSelect
              value={String(prefs.maxFps)}
              options={rates.map((r) => ({ value: String(r), label: `${r} fps` }))}
              onChange={(v) => setScreenPrefs({ maxFps: Number(v) })}
            />
          </Row>
          <Row label="Bitrate">
            <PrefSelect
              value={String(prefs.bitRate)}
              options={bitRates.map((b) => ({ value: String(b.value), label: b.label }))}
              onChange={(v) => setScreenPrefs({ bitRate: Number(v) })}
            />
          </Row>
          <p className="text-muted-foreground text-xs">
            H.265 and AV1 need less bandwidth for the same picture but are encoded in software on the emulator. A lower
            resolution, frame rate or bitrate helps on a slow connection.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const { keyboard } = prefs
              setScreenPrefs({ ...defaultScreenPrefs, keyboard })
            }}
          >
            Reset stream settings
          </Button>
        </div>

        <div className="grid gap-3 border-t pt-4">
          <p className="text-sm font-medium">Keyboard</p>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={prefs.keyboard}
            onValueChange={(v) => v && setScreenPrefs({ keyboard: v as KeyboardMode })}
            className="w-full"
          >
            <ToggleGroupItem value="text" className="flex-1">
              Text input
            </ToggleGroupItem>
            <ToggleGroupItem value="uhid" className="flex-1">
              Physical keyboard
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="text-muted-foreground text-xs">
            {prefs.keyboard === "text"
              ? "Typed characters are inserted as text. Only Latin characters work; for other alphabets use the physical keyboard."
              : "Android sees a USB keyboard and applies its own layout, so shortcuts and any alphabet work. Add your layouts in the device's physical keyboard settings and switch them with Ctrl+Space."}
          </p>
          {prefs.keyboard === "uhid" && (
            <Button
              size="sm"
              variant="outline"
              disabled={!connected}
              onClick={() => live.connection?.control.keyboardSettings()}
            >
              <KeyboardIcon />
              Keyboard layout settings
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="font-normal">{label}</Label>
      {children}
    </div>
  )
}

function PrefSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger size="sm" className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
