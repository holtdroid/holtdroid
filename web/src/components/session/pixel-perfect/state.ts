import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState, useSyncExternalStore } from "react"
import {
  api,
  type Display,
  type FigmaLayers,
  type ReferenceView,
  sessionBase,
  type UIHierarchy,
  unwrap,
} from "@/api/client"
import { keys } from "@/api/queries"
import type { LiveScreen } from "@/components/session/live-screen"
import { loadImage, pixelsOf, referencePixels, toCanvas, workSize } from "@/lib/pixel-perfect/capture"
import { type Analysis, analyze, boxMask, motionMask, type Pixels } from "@/lib/pixel-perfect/diff"
import {
  counterpart,
  type DesignLayer,
  type Measure,
  matchRegion,
  measure,
  type NativeView,
  placeLayers,
  placeViews,
  probeViews,
} from "@/lib/pixel-perfect/elements"
import { type Box, onScreen, type Placement, placeReference, type Size } from "@/lib/pixel-perfect/geometry"
import {
  Highlighter,
  matchWebView,
  probeWebViews,
  type ScreenElement,
  type WebViewMatch,
  type WebViewProbe,
} from "@/lib/pixel-perfect/webview"

export type Blend = "normal" | "difference" | "invert"
export type Tool = "none" | "move" | "ignore"

export type Frozen = { url: string; pixels: Pixels; motion: Uint8Array | null; at: number }

/** What a difference is part of: the page element, the native view and the design layer, and how the layer's implementation is off. */
export type RegionMatch = {
  element: ScreenElement | null
  view: NativeView | null
  layer: DesignLayer | null
  /** The element or view drawn where the layer is. */
  implementation: { label: string; box: Box } | null
  measures: Measure[]
}

type Views = { hierarchy: UIHierarchy | null; error: string | null }

export type Result = {
  analysis: Analysis
  screen: Pixels
  reference: Pixels
  motion: Uint8Array | null
  ignored: Box[]
  /** Device pixels per analysed pixel, for sizes shown to people. */
  toDevice: number
  referenceId: string
  source: "frozen" | "screenshot" | "stream"
  at: number
  /** The WebView found on the screen, if any. */
  webview: WebViewMatch | null
  /** The native views on the screen, when they could be read. */
  views: NativeView[]
  viewsError: string | null
  /** The reference's Figma layers over the screen. */
  layers: DesignLayer[]
  /** Where the reference lies, and analysed pixels per design unit. */
  frame: Box
  unit: number
  /** Device pixels per dp, when the screen's density is known. */
  density: number | null
  matches: RegionMatch[]
  /** Video, canvas and frames of the WebView left out of the comparison. */
  media: Box[]
}

export type Draft = { placement: Placement; ignore: Box[] }

export type PixelState = {
  referenceId: string | null
  visible: boolean
  opacity: number
  blend: Blend
  tool: Tool
  ignoreMotion: boolean
  ignoreMedia: boolean
  devtools: boolean
  views: boolean
  showRegions: boolean
  drafts: Record<string, Draft>
  frozen: Frozen | null
  freezing: boolean
  analyzing: boolean
  result: Result | null
  hovered: number | null
  error: string | null
}

type Prefs = Pick<
  PixelState,
  "visible" | "opacity" | "blend" | "ignoreMotion" | "ignoreMedia" | "devtools" | "views" | "showRegions"
>

const prefsKey = "holtdroid:pixel-perfect"
const defaults: Prefs = {
  visible: true,
  opacity: 0.5,
  blend: "normal",
  ignoreMotion: true,
  ignoreMedia: true,
  devtools: false,
  views: true,
  showRegions: true,
}

function loadPrefs(): Prefs {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(prefsKey) ?? "{}") as Partial<Prefs>) }
  } catch {
    return defaults
  }
}

const burst = 4
const burstGap = 140

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function frame() {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

export class PixelPerfect {
  #state: PixelState
  readonly #listeners = new Set<() => void>()
  readonly #images = new Map<string, Promise<HTMLImageElement>>()
  readonly #saves = new Map<string, number>()
  #rerun = 0
  #run = 0
  #display: Display | undefined
  #frozenProbes: Promise<WebViewProbe[]> | null = null
  #frozenViews: Promise<Views> | null = null
  readonly #layers = new Map<string, Promise<FigmaLayers | null>>()
  readonly #highlighter = new Highlighter()
  constructor(
    readonly live: LiveScreen,
    readonly provider: string,
    readonly id: string,
    readonly queryClient: QueryClient,
  ) {
    this.#state = {
      ...loadPrefs(),
      referenceId: null,
      tool: "none",
      drafts: {},
      frozen: null,
      freezing: false,
      analyzing: false,
      result: null,
      hovered: null,
      error: null,
    }
  }

  get = () => this.#state

  subscribe = (l: () => void) => {
    this.#listeners.add(l)
    return () => this.#listeners.delete(l)
  }

  set(patch: Partial<PixelState>) {
    this.#state = { ...this.#state, ...patch }
    const prefs: Prefs = {
      visible: this.#state.visible,
      opacity: this.#state.opacity,
      blend: this.#state.blend,
      ignoreMotion: this.#state.ignoreMotion,
      ignoreMedia: this.#state.ignoreMedia,
      devtools: this.#state.devtools,
      views: this.#state.views,
      showRegions: this.#state.showRegions,
    }
    try {
      localStorage.setItem(prefsKey, JSON.stringify(prefs))
    } catch {
      // storage may be unavailable; the settings then last for the page
    }
    for (const l of this.#listeners) l()
  }

  get references() {
    return this.queryClient.getQueryData<{ items: ReferenceView[] }>(keys.references)?.items ?? []
  }

  reference(id = this.#state.referenceId) {
    return this.references.find((r) => r.id === id) ?? null
  }

  hover(index: number | null) {
    if (index === this.#state.hovered) return
    this.set({ hovered: index })
    const result = this.#state.result
    const el = index === null ? null : result?.matches[index]?.element
    if (!result?.webview) return
    void this.#highlighter.show(result.webview.socket, el ? el.index : null, el?.tag).catch(() => undefined)
  }

  #probe() {
    if (!this.#state.devtools) return Promise.resolve([] as WebViewProbe[])
    return probeWebViews(this.provider, this.id).catch(() => [] as WebViewProbe[])
  }

  #views(): Promise<Views> {
    if (!this.#state.views) return Promise.resolve({ hierarchy: null, error: null })
    return probeViews(this.provider, this.id).then(
      (hierarchy) => ({ hierarchy, error: null }),
      (e: unknown) => ({ hierarchy: null, error: e instanceof Error ? e.message : String(e) }),
    )
  }

  layers(ref: ReferenceView) {
    if (!ref.layers) return Promise.resolve(null)
    const key = ref.imageUrl
    let p = this.#layers.get(key)
    if (!p) {
      p = unwrap(api.GET("/api/v1/pixel-perfect/{id}/layers", { params: { path: { id: ref.id } } })).catch(() => {
        this.#layers.delete(key)
        return null
      })
      this.#layers.set(key, p)
    }
    return p
  }

  draft(ref: ReferenceView): Draft {
    return this.#state.drafts[ref.id] ?? { placement: ref.placement, ignore: ref.ignore }
  }

  select(id: string | null) {
    this.set({ referenceId: id, result: null, hovered: null, tool: "none", error: null })
  }

  edit(ref: ReferenceView, patch: Partial<Draft>) {
    const next = { ...this.draft(ref), ...patch }
    this.set({ drafts: { ...this.#state.drafts, [ref.id]: next } })
    window.clearTimeout(this.#saves.get(ref.id))
    this.#saves.set(
      ref.id,
      window.setTimeout(() => void this.#save(ref.id), 700),
    )
    if (this.#state.result?.referenceId === ref.id) {
      if (this.#state.frozen) {
        window.clearTimeout(this.#rerun)
        this.#rerun = window.setTimeout(() => void this.analyze(), 250)
      } else {
        this.set({ result: null, hovered: null })
      }
    }
  }

  async #save(id: string) {
    const ref = this.reference(id)
    const draft = this.#state.drafts[id]
    if (!ref || !draft) return
    try {
      const saved = await unwrap(
        api.PUT("/api/v1/pixel-perfect/{id}", {
          params: { path: { id } },
          body: { name: ref.name, placement: draft.placement, ignore: draft.ignore },
        }),
      )
      this.queryClient.setQueryData<{ items: ReferenceView[] }>(keys.references, (old) =>
        old ? { ...old, items: old.items.map((r) => (r.id === id ? saved : r)) } : old,
      )
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  image(ref: ReferenceView) {
    let p = this.#images.get(ref.imageUrl)
    if (!p) {
      p = loadImage(ref.imageUrl).catch(() => {
        throw new Error("Could not load the reference")
      })
      p.catch(() => this.#images.delete(ref.imageUrl))
      this.#images.set(ref.imageUrl, p)
    }
    return p
  }

  async #snapshot() {
    const blob = await this.live.connection?.snapshot()
    if (!blob) throw new Error("The screen isn't connected")
    return blob
  }

  async #burst(size?: Size) {
    const blobs: Blob[] = []
    for (let i = 0; i < burst; i++) {
      if (i > 0) await sleep(burstGap)
      blobs.push(await this.#snapshot())
    }
    return Promise.all(blobs.map((b) => pixelsOf(b, size)))
  }

  async freeze() {
    if (this.#state.freezing) return
    this.set({ freezing: true, error: null })
    try {
      const first = await this.#snapshot()
      const probes = this.#probe()
      const views = this.#views()
      const pixels = await pixelsOf(first)
      const url = URL.createObjectURL(first)
      this.#release()
      this.#frozenProbes = probes
      this.#frozenViews = views
      this.set({ frozen: { url, pixels, motion: null, at: Date.now() }, result: null, hovered: null })
      const rest: Blob[] = []
      for (let i = 1; i < burst; i++) {
        await sleep(burstGap)
        rest.push(await this.#snapshot())
      }
      const frames = [
        pixels,
        ...(await Promise.all(rest.map((b) => pixelsOf(b, { w: pixels.width, h: pixels.height })))),
      ]
      const frozen = this.#state.frozen
      if (frozen?.url === url) this.set({ frozen: { ...frozen, motion: motionMask(frames) } })
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      this.set({ freezing: false })
    }
  }

  unfreeze() {
    this.#release()
    this.set({ frozen: null, result: null, hovered: null })
  }

  #release() {
    if (this.#state.frozen) URL.revokeObjectURL(this.#state.frozen.url)
    this.#frozenProbes = null
    this.#frozenViews = null
    void this.#highlighter.show("", null).catch(() => undefined)
  }

  async #screenshot() {
    const r = await fetch(`${sessionBase(this.provider, this.id)}/v1/device/screenshot`)
    if (!r.ok) throw new Error(`Screenshot failed (${r.status})`)
    return r.blob()
  }

  async analyze(display?: Display) {
    if (display) this.#display = display
    const ref = this.reference()
    if (!ref) return
    const run = ++this.#run
    this.set({ analyzing: true, error: null })
    await frame()
    try {
      const frozen = this.#state.frozen
      let screen: Pixels
      let motion: Uint8Array | null = null
      let source: Result["source"] = "frozen"
      let probes: WebViewProbe[]
      let views: Views
      if (frozen) {
        screen = frozen.pixels
        motion = frozen.motion
        probes = (await this.#frozenProbes) ?? []
        views = (await this.#frozenViews) ?? { hierarchy: null, error: null }
      } else {
        const [shot, frames, found, read] = await Promise.all([
          this.#screenshot().catch(() => null),
          this.#state.ignoreMotion ? this.#burst().catch(() => null) : null,
          this.#probe(),
          this.#views(),
        ])
        probes = found
        views = read
        if (shot) {
          const bitmap = await createImageBitmap(shot)
          screen = await pixelsOf(bitmap, workSize({ w: bitmap.width, h: bitmap.height }))
          bitmap.close()
          source = "screenshot"
        } else {
          screen = frames?.[0] ?? (await pixelsOf(await this.#snapshot()))
          source = "stream"
        }
        if (frames) {
          const target = { w: screen.width, h: screen.height }
          motion = motionMask(
            await Promise.all(
              frames.map((f) =>
                f.width === target.w && f.height === target.h ? Promise.resolve(f) : pixelsOf(toCanvas(f), target),
              ),
            ),
          )
        }
      }
      const size = { w: screen.width, h: screen.height }
      const [image, figma] = await Promise.all([this.image(ref), this.layers(ref)])
      const draft = this.draft(ref)
      const natural = { w: ref.width, h: ref.height }
      const reference = referencePixels(image, natural, size, draft.placement)
      const placed = placeReference(size, natural, draft.placement)
      const ignored = draft.ignore.map((r) => onScreen(placed, r))
      const d = this.#display
      const toDevice = d && d.width > 0 && d.height > 0 ? Math.max(d.width, d.height) / Math.max(size.w, size.h) : 1
      const webview = await matchWebView(probes, screen, toDevice).catch(() => null)
      const media = this.#state.ignoreMedia ? (webview?.media ?? []) : []
      const ignore = boxMask(size.w, size.h, [...ignored, ...media])
      if (this.#state.ignoreMotion && motion) for (let i = 0; i < ignore.length; i++) ignore[i]! |= motion[i]!
      const analysis = analyze(screen, reference, ignore)
      const native = views.hierarchy ? placeViews(views.hierarchy, toDevice, size) : []
      const layers = figma ? placeLayers(figma, placed, size) : []
      const unit = figma && figma.width > 0 ? placed.w / figma.width : 1
      const implementations = [
        ...(webview?.elements ?? []).map((e) => ({ label: e.label, box: e.box })),
        ...native.map((v) => ({ label: v.label, box: v.box })),
      ]
      const matches = analysis.regions.map((r): RegionMatch => {
        const layer = layers.length ? matchRegion(r, layers) : null
        const implementation = layer ? counterpart(layer.box, implementations) : null
        return {
          element: webview ? matchRegion(r, webview.elements) : null,
          view: matchRegion(r, native),
          layer,
          implementation,
          measures: layer && implementation ? measure(layer.box, implementation.box, placed, unit) : [],
        }
      })
      if (run !== this.#run) return
      this.set({
        result: {
          analysis,
          screen,
          reference,
          motion: this.#state.ignoreMotion ? motion : null,
          ignored,
          toDevice,
          referenceId: ref.id,
          source,
          at: Date.now(),
          webview,
          views: native,
          viewsError: views.error,
          layers,
          frame: placed,
          unit,
          density: d?.dpi ? d.dpi / 160 : null,
          matches,
          media,
        },
        hovered: null,
      })
    } catch (e) {
      if (run === this.#run) this.set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      if (run === this.#run) this.set({ analyzing: false })
    }
  }

  dispose() {
    this.#release()
    this.#highlighter.close()
    window.clearTimeout(this.#rerun)
    for (const t of this.#saves.values()) window.clearTimeout(t)
    this.#images.clear()
    this.#layers.clear()
  }
}

export function usePixelPerfect(live: LiveScreen, provider: string, id: string) {
  const qc = useQueryClient()
  const [pp] = useState(() => new PixelPerfect(live, provider, id, qc))
  useEffect(() => () => pp.dispose(), [pp])
  return pp
}

export function usePixelState(pp: PixelPerfect) {
  return useSyncExternalStore(pp.subscribe, pp.get)
}
