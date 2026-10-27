import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { measureImage } from "@/lib/recording/image-measure"
import {
  analyzeImages,
  type ImageMeasure,
  type ImageReport,
  type ImageRequest,
  type ImageShot,
} from "@/lib/recording/images"
import { analyzeSvg, optimizePaths, type SvgReport, type SvgSource } from "@/lib/recording/svgpaths"

const measurable = new Set(["png", "jpeg", "gif", "webp", "avif", "bmp"])

export type ImageInput = { requests: ImageRequest[]; shots: ImageShot[]; kinds: Map<string, string>; now: number }

/**
 * The images report, refined once this browser has re-encoded the recorded
 * images as WebP; measure says whether to do that now (the tab is open).
 */
export function useImageReport(input: ImageInput, measure: boolean): ImageReport {
  const first = useMemo(() => analyzeImages(input), [input])
  const wanted = measure ? first.entries.filter((e) => e.body && measurable.has(e.format)) : []
  const measures = useQueries({
    queries: wanted.map((e) => {
      const key = e.requests.findLast((r) => r.body && !r.bodyTruncated)!.key
      return {
        queryKey: ["image-measure", key, e.bytes, e.needed?.width ?? 0, e.needed?.height ?? 0],
        queryFn: async () => ({ key, m: await measureImage(e) }),
        staleTime: Infinity,
        gcTime: 10 * 60_000,
        retry: false,
      }
    }),
    combine: (results) => {
      const out = new Map<string, ImageMeasure>()
      for (const r of results) if (r.data?.m) out.set(r.data.key, r.data.m)
      return out
    },
  })
  const measured = measures.size
  return useMemo(
    () => (measured ? analyzeImages({ ...input, measures }) : first),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [first, input, measured],
  )
}

/** The SVG paths report, with svgo's shorter commands once optimize lets it run. */
export function useSvgReport(sources: SvgSource[], optimize: boolean): SvgReport {
  const first = useMemo(() => analyzeSvg(sources), [sources])
  const paths = first.sources.flatMap((s) => s.paths)
  const sig = `${paths.length}:${first.summary.bytes}:${first.sources.map((s) => s.source.key).join("|")}`
  const optimized = useQuery({
    queryKey: ["svg-optimize", sig],
    queryFn: () => optimizePaths(paths),
    enabled: optimize && paths.length > 0,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: false,
  }).data
  return useMemo(() => (optimized ? analyzeSvg(sources, optimized) : first), [first, optimized, sources])
}
