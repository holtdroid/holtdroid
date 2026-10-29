import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react"
import { Suspense, use, useEffect, useReducer, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import css from "./guides.css?inline"
import { Portal } from "./portal"
import { loadScenario } from "./scenarios"
import { stateAt, type Phase } from "./state"
import type { Lang, Scenario, Step } from "./types"

const WIDTH = 1180
const HEIGHT = 720

const ui = {
  en: {
    play: "Play",
    pause: "Pause",
    back: "Previous step",
    next: "Next step",
    restart: "Start over",
    step: "Step",
    of: "of",
    tap: "Click the picture for the next step",
  },
  ru: {
    play: "Воспроизвести",
    pause: "Пауза",
    back: "Предыдущий шаг",
    next: "Следующий шаг",
    restart: "Сначала",
    step: "Шаг",
    of: "из",
    tap: "Нажмите на картинку, чтобы перейти дальше",
  },
  uk: {
    play: "Відтворити",
    pause: "Пауза",
    back: "Попередній крок",
    next: "Наступний крок",
    restart: "Спочатку",
    step: "Крок",
    of: "з",
    tap: "Натисніть на картинку, щоб перейти далі",
  },
}

type Play = { index: number; phase: Phase; typed: number; auto: boolean; started: boolean }

type Action =
  | { type: "start" }
  | { type: "goto"; index: number; auto?: boolean }
  | { type: "phase"; phase: Phase }
  | { type: "typed"; typed: number }
  | { type: "auto"; auto: boolean }

function reduce(p: Play, a: Action): Play {
  switch (a.type) {
    case "start":
      return p.started ? p : { ...p, started: true, auto: true, phase: "move" }
    case "goto":
      return { index: a.index, phase: "move", typed: 0, auto: a.auto ?? p.auto, started: true }
    case "phase":
      return { ...p, phase: a.phase, typed: 0 }
    case "typed":
      return { ...p, typed: a.typed }
    case "auto":
      return { ...p, auto: a.auto, started: true }
  }
}

function readTime(step: Step, lang: Lang) {
  return step.hold ?? Math.min(7000, Math.max(2600, step.text[lang].length * 45))
}

function center(stage: HTMLElement, target: string | undefined, scale: number) {
  if (!target) return null
  const el = stage.querySelector<HTMLElement>(`[data-g="${CSS.escape(target)}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  const base = stage.getBoundingClientRect()
  return {
    x: (r.left - base.left) / scale,
    y: (r.top - base.top) / scale,
    w: r.width / scale,
    h: r.height / scale,
  }
}

export function Player({
  sc,
  lang,
  onFinish,
  compact,
  pace = 1,
}: {
  sc: Scenario
  lang: Lang
  onFinish?: () => void
  compact?: boolean
  pace?: number
}) {
  const t = ui[lang]
  const height = sc.height ?? HEIGHT
  const last = sc.steps.length - 1
  const [play, dispatch] = useReducer(reduce, { index: 0, phase: "move", typed: 0, auto: false, started: false })
  const [width, setWidth] = useState<number | null>(null)
  const [visible, setVisible] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<SVGSVGElement>(null)
  const rippleRef = useRef<HTMLSpanElement>(null)
  const focusRef = useRef<HTMLDivElement>(null)
  const scale = Math.min(1, (width ?? WIDTH) / WIDTH)
  const step = sc.steps[play.index]!
  const s = stateAt(sc, play)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return undefined
    const resize = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    const seen = new IntersectionObserver(
      ([entry]) => {
        const on = !!entry?.isIntersecting
        setVisible(on)
        if (on) dispatch({ type: "start" })
      },
      { threshold: 0.35 },
    )
    resize.observe(frame)
    seen.observe(frame)
    return () => {
      resize.disconnect()
      seen.disconnect()
    }
  }, [])

  useEffect(() => {
    const onHint = (e: Event) => {
      const detail = (e as CustomEvent<{ target?: string | null; step?: number }>).detail
      if (detail.step !== undefined) {
        if (detail.step >= 1 && detail.step <= sc.steps.length)
          dispatch({ type: "goto", index: detail.step - 1, auto: false })
        return
      }
      setHint(detail.target ?? null)
    }
    window.addEventListener("hd-guide", onHint)
    return () => window.removeEventListener("hd-guide", onHint)
  }, [sc])

  useEffect(() => {
    if (!play.started || !visible) return undefined
    const action = step.action ?? (step.type ? "type" : step.target ? "click" : "look")
    let timer = 0
    if (play.phase === "move") {
      timer = window.setTimeout(() => dispatch({ type: "phase", phase: "act" }), step.target ? 950 : 300)
    } else if (play.phase === "act") {
      if (action === "type" && step.type) {
        timer =
          play.typed < step.type.value.length
            ? window.setTimeout(() => dispatch({ type: "typed", typed: play.typed + 1 }), 45)
            : window.setTimeout(() => dispatch({ type: "phase", phase: "done" }), 200)
      } else if (action === "click") {
        rippleRef.current?.animate(
          [
            { transform: "translate(-50%, -50%) scale(0.2)", opacity: 0.6 },
            { transform: "translate(-50%, -50%) scale(1.6)", opacity: 0 },
          ],
          { duration: 450, easing: "ease-out" },
        )
        pointerRef.current?.animate([{ scale: 1 }, { scale: 0.82 }, { scale: 1 }], { duration: 260 })
        timer = window.setTimeout(() => dispatch({ type: "phase", phase: "done" }), 300)
      } else {
        timer = window.setTimeout(() => dispatch({ type: "phase", phase: "done" }), 150)
      }
    } else if (play.auto) {
      timer =
        play.index < last
          ? window.setTimeout(() => dispatch({ type: "goto", index: play.index + 1 }), readTime(step, lang) * pace)
          : onFinish
            ? window.setTimeout(onFinish, readTime(step, lang) * pace)
            : window.setTimeout(() => dispatch({ type: "auto", auto: false }), 0)
    }
    return () => window.clearTimeout(timer)
  }, [play, visible, step, last, lang, onFinish, pace])

  useEffect(() => {
    if (!visible || !step.target) return undefined
    const raf = requestAnimationFrame(() => {
      const el = stageRef.current?.querySelector<HTMLElement>(`[data-g="${CSS.escape(step.target ?? "")}"]`)
      const box = el?.closest<HTMLElement>("[data-scroll]")
      if (!el || !box) return
      const r = el.getBoundingClientRect()
      const b = box.getBoundingClientRect()
      const fit = (start: number, end: number, size: number, scroll: number) =>
        start >= 8 && end <= size - 8 ? scroll : scroll + start - Math.max(8, (size - (end - start)) / 3)
      box.scrollTo({
        top: fit((r.top - b.top) / scale, (r.bottom - b.top) / scale, b.height / scale, box.scrollTop),
        left: fit((r.left - b.left) / scale, (r.right - b.left) / scale, b.width / scale, box.scrollLeft),
        behavior: "smooth",
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [visible, step, scale])

  useEffect(() => {
    if (!visible) return undefined
    let raf = 0
    const tick = () => {
      const stage = stageRef.current
      if (stage) {
        const at = center(stage, step.target, scale)
        const cursor = cursorRef.current
        if (at && cursor) {
          const next = `translate(${at.x + at.w / 2}px, ${at.y + at.h * 0.55}px)`
          if (cursor.style.transform !== next) cursor.style.transform = next
        }
        const focus = focusRef.current
        const box = center(stage, hint ?? step.target, scale)
        if (focus) {
          if (box) {
            focus.style.opacity = "1"
            focus.style.transform = `translate(${box.x - 4}px, ${box.y - 4}px)`
            focus.style.width = `${box.w + 8}px`
            focus.style.height = `${box.h + 8}px`
          } else {
            focus.style.opacity = "0"
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [visible, step, hint, scale])

  const go = (index: number) => dispatch({ type: "goto", index: Math.max(0, Math.min(last, index)), auto: false })
  const finished = play.index === last && play.phase === "done" && !play.auto

  return (
    <div className={cn("hd-demo not-content grid gap-3", !compact && "my-6")} data-guide-player>
      <style href="hd-guides" precedence="default">
        {css}
      </style>
      <div
        ref={frameRef}
        role="button"
        tabIndex={0}
        aria-label={t.tap}
        title={t.tap}
        className="relative cursor-pointer overflow-hidden rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-sky-400/60"
        style={{ aspectRatio: `${WIDTH} / ${height}`, maxHeight: height }}
        onClick={() =>
          finished ? go(0) : play.phase === "done" ? go(play.index + 1) : dispatch({ type: "phase", phase: "done" })
        }
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(play.index + 1)
          else if (e.key === "ArrowLeft") go(play.index - 1)
          else if (e.key === " " || e.key === "Enter") {
            e.preventDefault()
            dispatch({ type: "auto", auto: !play.auto })
          } else return
          e.preventDefault()
        }}
      >
        <div
          ref={stageRef}
          inert
          className="pointer-events-none absolute top-0 left-0 origin-top-left select-none"
          style={{
            width: WIDTH,
            height,
            transform: `scale(${scale})`,
            visibility: width === null ? "hidden" : undefined,
          }}
        >
          <Portal s={s} />
          <div
            ref={focusRef}
            className="hd-focus pointer-events-none absolute top-0 left-0 z-[60] rounded-xl ring-2 ring-sky-500 ring-offset-2 ring-offset-transparent"
            style={{ opacity: 0, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.08)" }}
          />
          <div
            ref={cursorRef}
            className="hd-cursor pointer-events-none absolute top-0 left-0 z-[70]"
            style={{ transform: `translate(${WIDTH / 2}px, ${height - 60}px)` }}
          >
            <span ref={rippleRef} className="absolute top-0 left-0 size-14 rounded-full bg-sky-500/50 opacity-0" />
            <svg ref={pointerRef} width="26" height="30" viewBox="0 0 26 30" className="origin-top-left drop-shadow-md">
              <path
                d="M2 2l20 13.5-9 1.6 5.2 9.8-3.6 1.9-5.2-9.8L2 25z"
                fill="#111"
                stroke="#fff"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
        {compact && (
          <div className="absolute inset-x-0 top-0 flex h-1 gap-px">
            {sc.steps.map((st, i) => (
              <span
                key={st.text.en}
                className={cn("flex-1 transition-colors", i <= play.index ? "bg-primary" : "bg-transparent")}
              />
            ))}
          </div>
        )}
      </div>

      {compact && (
        <p aria-live="polite" className="text-muted-foreground flex min-h-10 gap-2 px-1 text-sm leading-5">
          <span className="text-foreground font-semibold tabular-nums">{play.index + 1}.</span>
          {step.text[lang]}
        </p>
      )}

      {!compact && (
        <div className="grid gap-3 rounded-xl border bg-card px-4 py-3 text-card-foreground">
          <div className="flex items-start gap-3">
            <span className="bg-primary text-primary-foreground grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums">
              {play.index + 1}
            </span>
            <p aria-live="polite" className="min-h-12 flex-1 text-[15px] leading-6">
              {step.text[lang]}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ControlButton label={t.back} disabled={play.index === 0} onClick={() => go(play.index - 1)}>
              <ChevronLeftIcon />
            </ControlButton>
            <ControlButton
              label={finished ? t.restart : play.auto ? t.pause : t.play}
              primary
              onClick={() =>
                finished
                  ? dispatch({ type: "goto", index: 0, auto: true })
                  : dispatch({ type: "auto", auto: !play.auto })
              }
            >
              {finished ? <RotateCcwIcon /> : play.auto ? <PauseIcon /> : <PlayIcon />}
            </ControlButton>
            <ControlButton label={t.next} disabled={play.index === last} onClick={() => go(play.index + 1)}>
              <ChevronRightIcon />
            </ControlButton>
            <div className="mx-2 flex flex-1 flex-wrap items-center gap-1">
              {sc.steps.map((st, i) => (
                <button
                  key={i}
                  type="button"
                  title={`${t.step} ${i + 1}: ${st.text[lang]}`}
                  aria-label={`${t.step} ${i + 1}`}
                  aria-current={i === play.index ? "step" : undefined}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-colors",
                    i < play.index ? "bg-primary/60" : i === play.index ? "bg-primary" : "bg-muted",
                  )}
                  onClick={() => go(i)}
                />
              ))}
            </div>
            <span className="text-muted-foreground text-xs tabular-nums">
              {t.step} {play.index + 1} {t.of} {sc.steps.length}
            </span>
            <ControlButton label={t.restart} onClick={() => dispatch({ type: "goto", index: 0, auto: true })}>
              <RotateCcwIcon />
            </ControlButton>
          </div>
        </div>
      )}
    </div>
  )
}

function ControlButton({
  label,
  primary,
  disabled,
  onClick,
  children,
}: {
  label: string
  primary?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-40 [&_svg]:size-4",
        primary ? "bg-primary text-primary-foreground hover:bg-primary/85" : "hover:bg-muted border",
      )}
    >
      {children}
    </button>
  )
}

function Loaded({ guide, lang }: { guide: string; lang: Lang }) {
  const sc = use(loadScenario(guide))
  return <Player sc={sc} lang={lang} />
}

export default function Guide({ guide, lang }: { guide: string; lang: Lang }) {
  return (
    <Suspense
      fallback={
        <div className="hd-demo not-content my-6 aspect-[1180/820] rounded-xl border bg-[var(--sl-color-gray-6)]" />
      }
    >
      <Loaded guide={guide} lang={lang} />
    </Suspense>
  )
}
