import {
  type AnimationEvent,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import Showcase, { type View } from "../../guides/showcase"
import type { PortalState } from "../../guides/types"

export type Frame = { state: Partial<PortalState>; hold: number; label?: string }

const FULL: View = [0, 0, 1180, 720]

function media(query: string) {
  return {
    subscribe: (change: () => void) => {
      const m = matchMedia(query)
      m.addEventListener("change", change)
      return () => m.removeEventListener("change", change)
    },
    get: () => matchMedia(query).matches,
  }
}

const narrowQuery = media("(max-width: 640px)")
const reduceQuery = media("(prefers-reduced-motion: reduce)")
const off = () => false

type Pos = { index: number; prev: number | null; run: number; picked: boolean }

function isViews(v: View | View[]): v is View[] {
  return Array.isArray(v[0])
}

export default function Scene({
  frames,
  still,
  view = FULL,
  narrowView,
  label,
  rail = false,
  cumulative = false,
  frame = "",
}: {
  frames: Frame[]
  still: number
  view?: View
  narrowView?: View | View[]
  label: string
  rail?: boolean
  cumulative?: boolean
  frame?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState<Pos>({ index: 0, prev: null, run: 0, picked: false })
  const narrow = useSyncExternalStore(narrowQuery.subscribe, narrowQuery.get, off)
  const reduce = useSyncExternalStore(reduceQuery.subscribe, reduceQuery.get, off)

  const states = useMemo(() => {
    const out: Partial<PortalState>[] = []
    for (const f of frames) out.push(cumulative ? { ...out.at(-1), ...f.state } : f.state)
    return out
  }, [frames, cumulative])

  const phases = useMemo(() => [...new Set(frames.map((f) => f.label ?? ""))], [frames])
  const labelOf = (i: number) => frames[i]?.label ?? ""
  const phaseOf = (i: number) => phases.indexOf(labelOf(i))

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    let shown = false
    const sync = () => setPlaying(shown && !document.hidden)
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        shown =
          entry.isIntersecting &&
          (entry.intersectionRatio >= 0.4 || entry.intersectionRect.height >= window.innerHeight * 0.25)
        if (entry.isIntersecting) setSeen(true)
        sync()
      },
      { threshold: [0, 0.01, 0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 1] },
    )
    io.observe(root)
    document.addEventListener("visibilitychange", sync)
    return () => {
      io.disconnect()
      document.removeEventListener("visibilitychange", sync)
    }
  }, [])

  useEffect(() => {
    if (!playing || reduce || pos.picked || frames.length < 2) return undefined
    const hold = frames[pos.index]?.hold ?? 1000
    const timer = setTimeout(() => {
      setPos((p) => {
        const next = (p.index + 1) % frames.length
        const phaseChange = (frames[next]?.label ?? "") !== (frames[p.index]?.label ?? "")
        return {
          index: next,
          prev: phaseChange ? p.index : null,
          run: phaseChange ? p.run + 1 : p.run,
          picked: p.picked,
        }
      })
    }, hold)
    return () => clearTimeout(timer)
  }, [playing, reduce, frames, pos])

  const index = reduce && !pos.picked ? still : pos.index
  const prev = reduce ? null : pos.prev
  const viewOf = (i: number): View => {
    if (!narrow || !narrowView) return view
    if (!isViews(narrowView)) return narrowView
    return narrowView[phaseOf(i)] ?? view
  }
  const [, , w, h] = viewOf(index)

  const pick = (phase: number) => {
    const first = frames.findIndex((f) => (f.label ?? "") === phases[phase])
    const last = frames.findLastIndex((f) => (f.label ?? "") === phases[phase])
    const target = reduce ? last : first
    if (target < 0) return
    setPos((p) => ({
      index: target,
      prev: !reduce && labelOf(target) !== labelOf(p.index) ? p.index : null,
      run: p.run + 1,
      picked: true,
    }))
  }

  const settle = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) setPos((p) => ({ ...p, prev: null }))
  }

  const layers = prev === null || labelOf(prev) === labelOf(index) ? [index] : [prev, index]
  const active = phaseOf(index)
  const phaseHold = frames.filter((f) => (f.label ?? "") === phases[active]).reduce((sum, f) => sum + f.hold, 0)

  return (
    <div className="l-scene">
      <div
        ref={rootRef}
        className={`l-scene-stage ${frame}`}
        style={{ "--ar": `${w} / ${h}` } as CSSProperties}
        role="img"
        aria-label={label}
      >
        {seen &&
          layers.map((i) => (
            <div
              key={labelOf(i)}
              className={layers.length > 1 && i === index ? "l-scene-layer l-scene-in" : "l-scene-layer"}
              onAnimationEnd={layers.length > 1 && i === index ? settle : undefined}
              aria-hidden="true"
            >
              <Showcase state={states[i] ?? {}} view={viewOf(i)} label={label} />
            </div>
          ))}
      </div>
      {rail && phases.length > 1 && (
        <div className={playing && !reduce && !pos.picked ? "l-rail" : "l-rail l-rail-paused"}>
          {phases.map((p, i) => (
            <button
              key={p}
              type="button"
              className="l-chip"
              aria-pressed={i === active}
              data-done={i < active ? "" : undefined}
              onClick={() => pick(i)}
            >
              <span className="l-chip-text">
                {i < active && (
                  <svg className="hd-i l-chip-check" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                )}
                <PhaseName name={p} />
              </span>
              <span className="l-chip-bar" aria-hidden="true">
                {i === active && (
                  <span
                    key={pos.run}
                    className="l-chip-fill"
                    style={{
                      animationDuration: `${phaseHold}ms`,
                    }}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PhaseName({ name }: { name: string }) {
  const [, num, rest] = /^(\d+) (.*)$/.exec(name) ?? []
  if (!num) return name
  return (
    <>
      <span className="l-chip-num">{num}</span>
      {rest}
    </>
  )
}
