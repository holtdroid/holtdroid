import { useQuery } from "@tanstack/react-query"
import { KeyboardIcon, LanguagesIcon } from "lucide-react"
import { useEffect, useEffectEvent, useRef } from "react"
import type { DeviceSettings, DeviceState } from "@/api/client"
import { CardLine, Note, ShadeCard, ShadeHeader, ShadePanel, ShadeRoot } from "@/components/session/shade"
import { useDevice, useUpdateDevice } from "@/components/session/use-device"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { LOCALES } from "@/lib/device-presets"
import { countryFlag } from "@/lib/format"
import { baseLayout, desiredLocales, detectLayouts, sameLocales } from "@/lib/keyboard-layouts"
import { setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"
import { cn } from "@/lib/utils"

const maxLayouts = 7

function languageName(tag: string, inLanguage?: string) {
  try {
    const name = new Intl.DisplayNames(inLanguage ? [inLanguage] : undefined, { type: "language" }).of(tag) ?? tag
    return name.charAt(0).toLocaleUpperCase(inLanguage) + name.slice(1)
  } catch {
    return tag
  }
}

function tagFlag(tag: string) {
  return countryFlag(tag.split("-")[1]) || "🌐"
}

export function LanguageWidget({ provider, id }: { provider: string; id: string }) {
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const { keyboardLayouts } = useScreenPrefs()
  const detected = useQuery({
    queryKey: ["keyboard-layouts"],
    queryFn: detectLayouts,
    staleTime: Infinity,
    enabled: keyboardLayouts === null,
  })
  const layouts = keyboardLayouts ?? detected.data ?? null
  const applied = useRef(false)
  const s = device.data

  const applyLayouts = useEffectEvent((l: string[]) => {
    if (!s || s.languageScope === "app") return
    const want = desiredLocales(s.locale, l)
    if (!sameLocales(want, s.locales)) update.mutate({ locales: want })
  })
  const ready = !!s && !!layouts
  useEffect(() => {
    if (!ready || applied.current || !layouts) return
    applied.current = true
    applyLayouts(layouts)
  }, [ready, layouts])

  const current = layouts ?? [baseLayout]
  const appOnly = s?.languageScope === "app"

  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <ShadeCard aria-label="Language and keyboard" changed={!!s && s.locale !== baseLayout}>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <LanguagesIcon className="size-4 shrink-0 text-neutral-400" />
            <span className="truncate">{s ? languageName(s.locale, s.locale) : "Language"}</span>
          </span>
          {s && (
            <CardLine icon={KeyboardIcon}>{appOnly ? "App language only" : current.map(tagFlag).join(" ")}</CardLine>
          )}
        </ShadeCard>
      </HoverCardTrigger>
      <ShadePanel>
        {s ? (
          <LanguageShade
            s={s}
            busy={update.isPending}
            set={(patch) => update.mutate(patch)}
            layouts={current}
            guessed={keyboardLayouts === null}
            layoutsReady={layouts !== null}
          />
        ) : (
          <Note>Loading the device…</Note>
        )}
      </ShadePanel>
    </ShadeRoot>
  )
}

function LanguageShade({
  s,
  busy,
  set,
  layouts,
  guessed,
  layoutsReady,
}: {
  s: DeviceState
  busy: boolean
  set: (patch: DeviceSettings) => void
  layouts: string[]
  guessed: boolean
  layoutsReady: boolean
}) {
  const appOnly = s.languageScope === "app"
  const tags = LOCALES.includes(s.locale) ? LOCALES : [s.locale, ...LOCALES]
  const pick = (tag: string) => set({ locales: appOnly ? [tag] : desiredLocales(tag, layouts) })
  const toggle = (tag: string) => {
    const next = layouts.includes(tag) ? layouts.filter((l) => l !== tag) : [...layouts, tag]
    setScreenPrefs({ keyboardLayouts: next })
    set({ locales: desiredLocales(s.locale, next) })
  }

  return (
    <>
      <ShadeHeader
        title={appOnly ? "App language" : "Language and keyboard"}
        summary={`${languageName(s.locale, s.locale)} · ${languageName(s.locale)}`}
        busy={busy}
        onReset={s.locale !== baseLayout ? () => pick(baseLayout) : undefined}
      />
      <section className="grid gap-1.5">
        <h4 className="px-1 text-xs font-medium text-neutral-400">{appOnly ? "App language" : "System language"}</h4>
        <LanguageGrid tags={tags} selected={(t) => t === s.locale} disabled={() => busy} onClick={pick} />
      </section>
      {appOnly ? (
        <Note>
          This phone can&apos;t change its system language without root, so this sets the app&apos;s own language.
          Keyboard languages are set in the phone&apos;s keyboard.
        </Note>
      ) : (
        <section className="grid gap-1.5">
          <h4 className="flex justify-between px-1 text-xs font-medium text-neutral-400">
            Keyboard layouts
            <span className="tabular-nums">
              {layouts.length} of {maxLayouts}
            </span>
          </h4>
          <LanguageGrid
            tags={LOCALES}
            selected={(t) => layouts.includes(t)}
            disabled={(_, on) => busy || !layoutsReady || (on ? layouts.length === 1 : layouts.length >= maxLayouts)}
            onClick={toggle}
          />
          <Note>
            {guessed ? "Picked from your keyboard. " : ""}Added as system languages, so the on-screen keyboard offers
            them; switch with its globe key or Ctrl+Space. Remembered in this browser.
          </Note>
        </section>
      )}
    </>
  )
}

function LanguageGrid({
  tags,
  selected,
  disabled,
  onClick,
}: {
  tags: string[]
  selected: (tag: string) => boolean
  disabled: (tag: string, on: boolean) => boolean
  onClick: (tag: string) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {tags.map((tag) => {
        const on = selected(tag)
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={on}
            title={`${languageName(tag)} · ${tag}`}
            disabled={disabled(tag, on)}
            className={cn(
              "flex min-w-0 flex-col items-center gap-0.5 rounded-2xl px-1 py-2 transition-colors disabled:cursor-default",
              on
                ? "bg-sky-200 text-sky-950 hover:bg-sky-100"
                : "bg-neutral-800 text-neutral-100 hover:bg-neutral-700 disabled:opacity-40 disabled:hover:bg-neutral-800",
            )}
            onClick={() => onClick(tag)}
          >
            <span className="text-xl leading-none">{tagFlag(tag)}</span>
            <span className="w-full truncate text-center text-[11px] leading-tight">{languageName(tag, tag)}</span>
            <span className={cn("text-[10px] leading-none", on ? "text-sky-900" : "text-neutral-500")}>{tag}</span>
          </button>
        )
      })}
    </div>
  )
}
