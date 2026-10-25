import { MoonIcon, SunIcon, SunMediumIcon, SunMoonIcon, TypeIcon, type LucideIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useEffectEvent, useRef } from "react"
import type { DeviceSettings, DeviceState } from "@/api/client"
import {
  CardLine,
  Chips,
  Note,
  Row,
  Section,
  ShadeCard,
  ShadeHeader,
  ShadePanel,
  ShadeRoot,
  ShadeSlider,
  Tile,
} from "@/components/session/shade"
import { useDevice, useUpdateDevice } from "@/components/session/use-device"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"

const fontScales = [0.85, 1, 1.15, 1.3, 1.5, 2].map((f) => ({ value: f, label: `${Math.round(f * 100)}%` }))

const displaySizes = [
  { value: 0.85, label: "Small" },
  { value: 1, label: "Default" },
  { value: 1.15, label: "Large" },
  { value: 1.3, label: "Larger" },
]

type ThemeMode = "light" | "dark" | "sync"

const themes: Record<ThemeMode, { label: string; hint: string; icon: LucideIcon }> = {
  light: { label: "Light", hint: "Dark theme off", icon: SunIcon },
  dark: { label: "Dark", hint: "Dark theme on", icon: MoonIcon },
  sync: { label: "Match the portal", hint: "Follows this page's theme", icon: SunMoonIcon },
}

type Set = (patch: DeviceSettings) => void

export function DisplayWidget({ provider, id }: { provider: string; id: string }) {
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const s = device.data
  if (!s) {
    return (
      <ShadeCard aria-label="Display" disabled>
        <CardLine icon={SunMediumIcon}>Display</CardLine>
      </ShadeCard>
    )
  }
  return <Display s={s} busy={update.isPending} set={(patch) => update.mutate(patch)} />
}

function Display({ s, busy, set }: { s: DeviceState; busy: boolean; set: Set }) {
  const { deviceTheme } = useScreenPrefs()
  const { resolvedTheme } = useTheme()
  const siteDark = resolvedTheme === "dark"
  const mode: ThemeMode = deviceTheme === "sync" ? "sync" : s.darkMode ? "dark" : "light"
  const synced = useRef<boolean | null>(null)

  const follow = useEffectEvent(() => {
    if (deviceTheme !== "sync" || s.darkMode === siteDark || synced.current === siteDark) return
    synced.current = siteDark
    set({ darkMode: siteDark })
  })
  const drifted = deviceTheme === "sync" && s.darkMode !== siteDark
  useEffect(() => {
    if (drifted) follow()
  }, [drifted])

  const choose = (m: ThemeMode) => {
    if (m === "sync") {
      synced.current = null
      setScreenPrefs({ deviceTheme: "sync" })
      return
    }
    setScreenPrefs({ deviceTheme: "manual" })
    if (s.darkMode !== (m === "dark")) set({ darkMode: m === "dark" })
  }

  const font = fontScales.find((f) => Math.abs(f.value - s.fontScale) < 0.01)?.value ?? 0
  const size = displaySizes.find((d) => Math.round(s.defaultDensity * d.value) === s.density)
  const resized = s.defaultDensity > 0 && s.density !== s.defaultDensity
  const changed = Math.abs(s.fontScale - 1) > 0.01 || resized || mode === "dark"
  const brightness = s.autoBrightness ? "auto" : `${s.brightness}%`

  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <ShadeCard aria-label="Display" changed={changed}>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold tabular-nums">
            <SunMediumIcon className="size-4 shrink-0 text-neutral-400" />
            {s.autoBrightness ? "Auto" : `${s.brightness}%`}
          </span>
          <CardLine icon={s.darkMode ? MoonIcon : SunIcon}>{s.darkMode ? "Dark theme" : "Light theme"}</CardLine>
          <CardLine icon={TypeIcon}>
            Font {Math.round(s.fontScale * 100)}%{resized && ` · ${size?.label.toLowerCase() ?? `${s.density} dpi`}`}
          </CardLine>
        </ShadeCard>
      </HoverCardTrigger>
      <ShadePanel>
        <ShadeHeader
          title="Display"
          summary={`${themes[mode].label} · font ${Math.round(s.fontScale * 100)}% · brightness ${brightness}`}
          busy={busy}
          onReset={
            changed
              ? () => {
                  if (mode === "dark") choose("light")
                  set({ fontScale: 1, ...(resized && { density: 0 }) })
                }
              : undefined
          }
        />
        <section className="grid gap-2">
          <ShadeSlider
            key={s.brightness}
            icon={SunMediumIcon}
            label="Brightness"
            value={s.brightness}
            max={100}
            unit="%"
            disabled={busy}
            onCommit={(b) => set({ brightness: b })}
          />
          <div className="grid grid-cols-2 gap-2">
            <Tile
              icon={SunMoonIcon}
              label="Adaptive"
              status={s.autoBrightness ? "On" : "Off"}
              on={s.autoBrightness}
              disabled={busy}
              onClick={() => set({ autoBrightness: !s.autoBrightness })}
            />
            <Tile
              icon={MoonIcon}
              label="Dark theme"
              status={mode === "sync" ? "Matches the portal" : undefined}
              on={s.darkMode}
              disabled={busy}
              onClick={() => choose(s.darkMode ? "light" : "dark")}
            />
          </div>
          <Note>
            The stream shows the picture before the backlight, so it doesn&apos;t get darker; the device and its apps
            see the setting. Brightness lasts for this session only.
          </Note>
        </section>
        <Section title="Theme">
          {(Object.entries(themes) as [ThemeMode, (typeof themes)[ThemeMode]][]).map(([m, t]) => (
            <Row key={m} selected={m === mode} icon={t.icon} title={t.label} disabled={busy} onClick={() => choose(m)}>
              {t.hint}
            </Row>
          ))}
        </Section>
        <Chips title="Font size" options={fontScales} value={font} onChange={(fontScale) => set({ fontScale })} />
        {s.defaultDensity > 0 && (
          <Chips
            title="Display size"
            options={displaySizes}
            value={size?.value ?? 0}
            onChange={(k) => set({ density: k === 1 ? 0 : Math.round(s.defaultDensity * k) })}
          />
        )}
      </ShadePanel>
    </ShadeRoot>
  )
}
