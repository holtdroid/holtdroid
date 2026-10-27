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
import { keys, referenceLayersQuery } from "@/api/queries"
import type { LiveScreen } from "@/components/session/live-screen"
import { blobURL, loadImage, pixelsOf, referencePixels, toCanvas, workSize } from "@/lib/pixel-perfect/capture"
import { composeReference, hiddenFractions, needsComposite } from "@/lib/pixel-perfect/compose"
import { areaBox, outside, pxPerDp, type ReferenceLayout } from "@/lib/pixel-perfect/layout"
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
export type Tool = "none" | "move" | "ignore" | "area" | "guides"
export type Tab = "layout" | "components" | "compare"

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

export type Draft = { placement: Placement; ignore: Box[]; hidden: string[]; layout: ReferenceLayout }

export type PixelState = {
  referenceId: string | null
  visible: boolean
  opacity: number
  blend: Blend
  tool: Tool
  tab: Tab
  ignoreMotion: boolean
  ignoreMedia: boolean
  devtools: boolean
  views: boolean
  showRegions: boolean
  showLayout: boolean
  skipHidden: boolean
  drafts: Record<string, Draft>
  /** The reference redrawn without its hidden components, for the overlay. */
  composite: { key: string; url: string } | null
  hoveredComponent: string | null
  /** A still picture of the screen for the loupe while drawing. */
  loupe: Pixels | null
  /** A work area being considered, as fractions of the screen, outlined until it is picked. */
  preview: Box | null
  /** The Pixel perfect tab is open; nothing is drawn over the screen otherwise. */
  shown: boolean
  frozen: Frozen | null
  freezing: boolean
  analyzing: boolean
  result: Result | null
  hovered: number | null
  error: string | null
}

export type Prefs = Pick<
  PixelState,
  | "visible"
  | "opacity"
  | "blend"
  | "ignoreMotion"
  | "ignoreMedia"
  | "devtools"
  | "views"
  | "showRegions"
  | "showLayout"
  | "skipHidden"
>

const prefsKey = "holtdroid:pixel-perfect"
export const defaultPrefs: Prefs = {
  visible: true,
  opacity: 0.5,
  blend: "normal",
  ignoreMotion: true,
  ignoreMedia: true,
  devtools: false,
  views: true,
  showRegions: true,
  showLayout: true,
  skipHidden: true,
}

export function loadPrefs(): Prefs {
  try {
    return { ...defaultPrefs, ...(JSON.parse(localStorage.getItem(prefsKey) ?? "{}") as Partial<Prefs>) }
  } catch {
    return defaultPrefs
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

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(prefsKey, JSON.stringify(prefs))
  } catch {
    // storage may be unavailable; the settings then last for the page
  }
}

const precise = new Set<Tool>(["area", "ignore", "guides"])

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
  readonly #composites = new Map<string, Promise<OffscreenCanvas>>()
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
      tab: "layout",
      drafts: {},
      composite: null,
      hoveredComponent: null,
      loupe: null,
      preview: null,
      shown: false,
      frozen: null,
      freezing: false,
      analyzing: false,
      result: null,
      hovered: null,
      error: null,
    }
  }

  get = () => this.#state

  async #loadLoupe() {
    try {
      const frozen = this.#state.frozen
      const pixels = frozen ? frozen.pixels : await pixelsOf(await this.#snapshot())
      if (precise.has(this.#state.tool)) this.set({ loupe: pixels })
    } catch {
      // without a picture the loupe isn't shown; drawing still works
    }
  }

  setDisplay(display: Display | undefined) {
    if (!display || display === this.#display) return
    this.#display = display
    this.set({})
  }

  /** Screen pixels per dp on a screen drawn at this size. */
  pxPerDp(size: Size) {
    return pxPerDp(this.#display, size)
  }

  layout(ref: ReferenceView) {
    return this.draft(ref).layout
  }

  editLayout(ref: ReferenceView, patch: Partial<ReferenceLayout>) {
    this.edit(ref, { layout: { ...this.layout(ref), ...patch } })
  }

  subscribe = (l: () => void) => {
    this.#listeners.add(l)
    return () => this.#listeners.delete(l)
  }

  set(patch: Partial<PixelState>) {
    const tool = this.#state.tool
    this.#state = { ...this.#state, ...patch }
    if (patch.tool && patch.tool !== tool) {
      if (precise.has(patch.tool)) void this.#loadLoupe()
      else this.#state = { ...this.#state, loupe: null }
    }
    const prefs: Prefs = {
      visible: this.#state.visible,
      opacity: this.#state.opacity,
      blend: this.#state.blend,
      ignoreMotion: this.#state.ignoreMotion,
      ignoreMedia: this.#state.ignoreMedia,
      devtools: this.#state.devtools,
      views: this.#state.views,
      showRegions: this.#state.showRegions,
      showLayout: this.#state.showLayout,
      skipHidden: this.#state.skipHidden,
    }
    savePrefs(prefs)
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

  layers(ref: ReferenceView): Promise<FigmaLayers | null> {
    if (!ref.layers) return Promise.resolve(null)
    return this.queryClient.fetchQuery(referenceLayersQuery(ref)).catch(() => null)
  }

  draft(ref: ReferenceView): Draft {
    return (
      this.#state.drafts[ref.id] ?? {
        placement: ref.placement,
        ignore: ref.ignore,
        hidden: ref.hidden,
        layout: ref.layout,
      }
    )
  }

  select(id: string | null) {
    this.set({ referenceId: id, result: null, hovered: null, hoveredComponent: null, tool: "none", error: null })
    const ref = this.reference(id)
    if (ref) void this.#compose(ref)
  }

  /** The reference without its hidden components, or null when nothing is hidden. */
  async #composite(ref: ReferenceView, layers: FigmaLayers | null, hidden: string[]) {
    if (!layers || !needsComposite(layers, hidden)) return null
    const key = `${ref.imageUrl}#${hidden.toSorted().join(",")}`
    let p = this.#composites.get(key)
    if (!p) {
      p = composeReference(layers, hidden, (url) => this.#loadImage(url))
      p.catch(() => this.#composites.delete(key))
      this.#composites.set(key, p)
    }
    return { key, canvas: await p }
  }

  async #compose(ref: ReferenceView) {
    try {
      const hidden = this.draft(ref).hidden
      const made = await this.#composite(ref, await this.layers(ref), hidden)
      const current = this.#state.composite
      if (made && current?.key === made.key) return
      const url = made ? await blobURL(made.canvas) : null
      if (this.reference()?.id !== ref.id || this.draft(ref).hidden !== hidden) {
        if (url) URL.revokeObjectURL(url)
        return
      }
      if (current) URL.revokeObjectURL(current.url)
      this.set({ composite: made && url ? { key: made.key, url } : null })
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  overlaySource(ref: ReferenceView) {
    const c = this.#state.composite
    return c?.key.startsWith(`${ref.imageUrl}#`) ? c.url : ref.imageUrl
  }

  hoverComponent(id: string | null) {
    if (id !== this.#state.hoveredComponent) this.set({ hoveredComponent: id })
  }

  edit(ref: ReferenceView, patch: Partial<Draft>) {
    const next = { ...this.draft(ref), ...patch }
    this.set({ drafts: { ...this.#state.drafts, [ref.id]: next } })
    window.clearTimeout(this.#saves.get(ref.id))
    this.#saves.set(
      ref.id,
      window.setTimeout(() => void this.#save(ref.id), 700),
    )
    if (patch.hidden) void this.#compose(ref)
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
          body: {
            name: ref.name,
            placement: draft.placement,
            ignore: draft.ignore,
            hidden: draft.hidden,
            layout: draft.layout,
          },
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
    return this.#loadImage(ref.imageUrl)
  }

  #loadImage(url: string) {
    let p = this.#images.get(url)
    if (!p) {
      p = loadImage(url).catch(() => {
        throw new Error("Could not load the reference")
      })
      p.catch(() => this.#images.delete(url))
      this.#images.set(url, p)
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

  /** The device's screen at its own resolution. */
  async screenshotPixels() {
    return pixelsOf(await this.#screenshot())
  }

  async #screenshot() {
    const r = await fetch(`${sessionBase(this.provider, this.id)}/v1/device/screenshot`)
    if (!r.ok) throw new Error(`Screenshot failed (${r.status})`)
    return r.blob()
  }

  /** Finds the differences; show switches the tab to them. */
  async analyze(display?: Display, show = false) {
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
      const composite = await this.#composite(ref, figma, this.draft(ref).hidden)
      const draft = this.draft(ref)
      const natural = { w: ref.width, h: ref.height }
      const area = areaBox(draft.layout.area, size, pxPerDp(this.#display, size))
      const reference = referencePixels(composite?.canvas ?? image, natural, size, draft.placement, area)
      const placed = placeReference(area, natural, draft.placement)
      const ignored = [
        ...draft.ignore,
        ...(this.#state.skipHidden && composite ? hiddenFractions(figma, draft.hidden) : []),
      ].map((r) => onScreen(placed, r))
      const d = this.#display
      const toDevice = d && d.width > 0 && d.height > 0 ? Math.max(d.width, d.height) / Math.max(size.w, size.h) : 1
      const webview = await matchWebView(probes, screen, toDevice).catch(() => null)
      const media = this.#state.ignoreMedia ? (webview?.media ?? []) : []
      const ignore = boxMask(size.w, size.h, [...ignored, ...media, ...outside(area, size)])
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
        ...(show ? { tab: "compare" as const } : {}),
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
    this.#composites.clear()
    if (this.#state.composite) URL.revokeObjectURL(this.#state.composite.url)
  }
}

export function usePixelPerfect(live: LiveScreen, provider: string, id: string, display?: Display) {
  const qc = useQueryClient()
  const [pp] = useState(() => new PixelPerfect(live, provider, id, qc))
  useEffect(() => pp.setDisplay(display), [pp, display])
  useEffect(() => () => pp.dispose(), [pp])
  return pp
}

export function usePixelState(pp: PixelPerfect) {
  return useSyncExternalStore(pp.subscribe, pp.get)
}
