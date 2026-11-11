import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react"
import { Suspense, use, useEffect, useReducer, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import css from "./guides.css?inline"
import { Portal } from "./portal"
import { loadScenario } from "./scenarios"
import { clip, reveal, type Rect } from "./scroll"
import { stateAt, type Phase } from "./state"
import type { Lang, Scenario, Step } from "./types"

const WIDTH = 1180
const HEIGHT = 720
const SPEEDS = [1, 1.5, 2]
const VEIL = "0 0 0 9999px rgb(0 0 0 / 0.3)"

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
    steps: "Steps",
    speed: "Playback speed",
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
    steps: "Шаги",
    speed: "Скорость воспроизведения",
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
    steps: "Кроки",
    speed: "Швидкість відтворення",
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

function find(stage: HTMLElement, target: string | undefined) {
  return target ? stage.querySelector<HTMLElement>(`[data-g="${CSS.escape(target)}"]`) : null
}

function locate(stage: HTMLElement, target: string | undefined, scale: number) {
  const el = find(stage, target)
  if (!el) return null
  const base = stage.getBoundingClientRect()
  const scene = (r: DOMRect): Rect => ({
    top: (r.top - base.top) / scale,
    left: (r.left - base.left) / scale,
    bottom: (r.bottom - base.top) / scale,
    right: (r.right - base.left) / scale,
  })
  const view = el.closest<HTMLElement>("[data-scroll]")
  const r = scene(el.getBoundingClientRect())
  const shown = view ? clip(r, scene(view.getBoundingClientRect())) : r
  if (!shown) return null
  return {
    x: shown.left,
    y: shown.top,
    w: shown.right - shown.left,
    h: shown.bottom - shown.top,
    modal: !!el.closest("[data-modal]"),
  }
}

export function Player({ sc, lang }: { sc: Scenario; lang: Lang }) {
  const t = ui[lang]
  const [speed, setSpeed] = useState(1)
  const pace = 1 / speed
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
      timer = window.setTimeout(
        () => dispatch({ type: "phase", phase: "act" }),
        (step.target ? 950 : 300) * Math.max(pace, 0.45),
      )
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
          : window.setTimeout(() => dispatch({ type: "auto", auto: false }), 0)
    }
    return () => window.clearTimeout(timer)
  }, [play, visible, step, last, lang, pace])

  useEffect(() => {
    if (!visible || !step.target) return undefined
    const raf = requestAnimationFrame(() => {
      const el = stageRef.current && find(stageRef.current, step.target)
      const box = el?.closest<HTMLElement>("[data-scroll]")
      if (!el || !box) return
      const to = reveal(
        el.getBoundingClientRect(),
        box.getBoundingClientRect(),
        { top: box.scrollTop * scale, left: box.scrollLeft * scale },
        {
          top: (box.scrollHeight - box.clientHeight) * scale,
          left: (box.scrollWidth - box.clientWidth) * scale,
        },
        8 * scale,
      )
      box.scrollTo({
        top: to.top / scale,
        left: to.left / scale,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
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
        const at = locate(stage, step.target, scale)
        const cursor = cursorRef.current
        if (at && cursor) {
          const next = `translate(${at.x + at.w / 2}px, ${at.y + at.h * 0.55}px)`
          if (cursor.style.transform !== next) cursor.style.transform = next
        }
        const focus = focusRef.current
        const box = locate(stage, hint ?? step.target, scale)
        if (focus) {
          if (box) {
            focus.style.opacity = "1"
            focus.style.boxShadow = box.modal ? "none" : VEIL
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
    <div
      className="hd-demo not-content bg-card text-card-foreground my-6 flex flex-wrap overflow-hidden rounded-2xl border"
      data-guide-player
    >
      <style href="hd-guides" precedence="default">
        {css}
      </style>
      <div className="flex min-w-0 flex-[999_1_560px] flex-col">
        <div
          ref={frameRef}
          role="button"
          tabIndex={0}
          aria-label={t.tap}
          title={t.tap}
          className="bg-background focus-visible:ring-info/60 relative cursor-pointer overflow-hidden outline-none focus-visible:ring-3 focus-visible:ring-inset"
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
              className="hd-focus ring-info pointer-events-none absolute top-0 left-0 z-[60] rounded-xl ring-3"
              style={{ opacity: 0 }}
            />
            <div
              ref={cursorRef}
              className="hd-cursor pointer-events-none absolute top-0 left-0 z-[70]"
              style={{
                transform: `translate(${WIDTH / 2}px, ${height - 60}px)`,
                transitionDuration: pace < 1 ? `${Math.round(750 * Math.max(pace, 0.45))}ms` : undefined,
              }}
            >
              <span ref={rippleRef} className="bg-info/50 absolute top-0 left-0 size-14 rounded-full opacity-0" />
              <svg
                ref={pointerRef}
                width="20"
                height="28"
                viewBox="0 0 20 28"
                className="origin-top-left drop-shadow-md"
              >
                <path
                  d="M2 2v19.5l4.8-4.5 3.2 7.6 3.4-1.4-3.1-7.4h6.5z"
                  fill="#111"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3 border-t px-4 pt-3">
          <span className="text-muted-foreground shrink-0 pt-1 text-xs font-medium tabular-nums">
            {t.step} {play.index + 1} {t.of} {sc.steps.length}
          </span>
          <p aria-live="polite" className="min-h-12 flex-1 text-[15px] leading-6">
            {step.text[lang]}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 pt-1 pb-3">
          <ControlButton label={t.back} disabled={play.index === 0} onClick={() => go(play.index - 1)}>
            <ChevronLeftIcon />
          </ControlButton>
          <ControlButton
            label={finished ? t.restart : play.auto ? t.pause : t.play}
            primary
            onClick={() =>
              finished ? dispatch({ type: "goto", index: 0, auto: true }) : dispatch({ type: "auto", auto: !play.auto })
            }
          >
            {finished ? <RotateCcwIcon /> : play.auto ? <PauseIcon /> : <PlayIcon />}
          </ControlButton>
          <ControlButton label={t.next} disabled={play.index === last} onClick={() => go(play.index + 1)}>
            <ChevronRightIcon />
          </ControlButton>
          <div className="mx-2 flex min-w-40 flex-1 items-center gap-[3px]">
            {sc.steps.map((st, i) => (
              <button
                key={i}
                type="button"
                title={`${t.step} ${i + 1}: ${st.text[lang]}`}
                aria-label={`${t.step} ${i + 1}`}
                aria-current={i === play.index ? "step" : undefined}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  i < play.index ? "bg-primary" : i === play.index ? "bg-info" : "bg-border",
                )}
                onClick={() => go(i)}
              />
            ))}
          </div>
          <ControlButton label={t.restart} small onClick={() => dispatch({ type: "goto", index: 0, auto: true })}>
            <RotateCcwIcon />
          </ControlButton>
          <button
            type="button"
            title={t.speed}
            aria-label={`${t.speed}: ${speed}×`}
            onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1)}
            className="hover:bg-muted h-7 shrink-0 rounded-lg border px-2.5 text-[13px] font-medium tabular-nums transition-colors"
          >
            {speed}×
          </button>
        </div>
      </div>

      <div className="relative min-h-64 min-w-0 flex-[1_1_240px] border-l">
        <ol aria-label={t.steps} className="absolute inset-0 flex flex-col gap-0.5 overflow-y-auto p-3">
          <li
            aria-hidden="true"
            className="text-muted-foreground px-2.5 pt-1 pb-2 text-xs font-semibold tracking-[0.06em] uppercase"
          >
            {t.steps}
          </li>
          {sc.steps.map((st, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => go(i)}
                aria-current={i === play.index ? "step" : undefined}
                className={cn(
                  "flex min-h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] leading-snug transition-colors",
                  i === play.index ? "bg-muted font-medium" : "hover:bg-muted/60",
                )}
              >
                {i < play.index ? (
                  <CheckIcon className="text-success size-4 shrink-0" />
                ) : (
                  <span
                    className={cn(
                      "mx-px size-3.5 shrink-0 rounded-full border-[1.5px]",
                      i === play.index ? "border-info" : "border-border",
                    )}
                  />
                )}
                <span className={cn("line-clamp-2", i > play.index && "text-muted-foreground")}>{st.text[lang]}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function ControlButton({
  label,
  primary,
  small,
  disabled,
  onClick,
  children,
}: {
  label: string
  primary?: boolean
  small?: boolean
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
        "grid shrink-0 place-items-center transition-colors disabled:opacity-40 [&_svg]:size-4",
        primary
          ? "bg-primary text-primary-foreground hover:bg-primary/85 size-10 rounded-xl"
          : small
            ? "hover:bg-muted size-7 rounded-lg border"
            : "hover:bg-muted size-8 rounded-[9px] border",
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
    <Suspense fallback={<div className="hd-demo not-content bg-card my-6 aspect-[1180/800] rounded-2xl border" />}>
      <Loaded guide={guide} lang={lang} />
    </Suspense>
  )
}
