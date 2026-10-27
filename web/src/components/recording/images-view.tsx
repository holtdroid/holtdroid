import { Details, Section, TimeButton } from "@/components/recording/devtools-view"
import { FindingList, FindingTitle, Rich, Stat, Stats } from "@/components/recording/findings"
import { Pairs } from "@/components/recording/json-view"
import { formatBytes } from "@/lib/format"
import { splitURL } from "@/lib/recording/devtools"
import { type ImageEntry, type ImageFinding, type ImageReport, showWindow, webpQuality } from "@/lib/recording/images"
import { cn } from "@/lib/utils"

const kindLabel: Record<string, string> = {
  img: "<img>",
  css: "CSS background",
  svg: "SVG <image>",
  poster: "video poster",
  input: "image button",
}

const size = (s?: { width: number; height: number }) => (s ? `${Math.round(s.width)}×${Math.round(s.height)}` : "–")

/**
 * The images the WebViews loaded against how their pages draw them, as
 * findings. In a recording a time seeks there and a request opens in
 * Network; live, the device clock is shown.
 */
export function ImagesView({
  report,
  picked,
  onPick,
  onSeek,
  onReveal,
  wallClock,
  empty,
  live,
}: {
  report: ImageReport
  picked?: string
  onPick: (id: string | undefined) => void
  onSeek?: (t: number) => void
  onReveal?: (request: string) => void
  wallClock?: (ms: number) => string
  empty: string
  /** a session's tab, which explains a missing scan itself */
  live?: boolean
}) {
  const { summary: s, findings } = report
  const selected = picked ? findings.find((f) => f.id === picked) : undefined
  return (
    <>
      <Stats>
        <Stat label="Images" value={s.images} />
        <Stat label="Downloaded" value={formatBytes(s.downloaded)} />
        {s.shots && (
          <Stat
            label="Not on screen"
            value={formatBytes(s.unshown)}
            title={`Loaded but not shown within ${showWindow / 1000} s, or drawn nowhere`}
          />
        )}
        {s.saving > 0 && (
          <Stat
            label="Could save"
            value={formatBytes(s.saving)}
            title="Each image at its smallest: not loaded, at the size drawn or as WebP"
          />
        )}
      </Stats>
      {!s.shots && s.images > 0 && !live && (
        <p className="px-4 pb-2 text-xs text-stage-outline">
          Recorded without the image scan, a launch option, so only the files themselves are checked.
        </p>
      )}
      <FindingList
        findings={findings.map((f) => ({
          id: f.id,
          severity: f.severity,
          title: f.title,
          saving: f.saving,
          savingTitle: f.estimated ? "Could save, estimated" : "Could save",
          count: f.requests.length,
          countTitle: "Requests",
        }))}
        picked={picked}
        onPick={onPick}
        empty={s.images ? "Nothing to improve in these images" : empty}
      />
      {selected && (
        <ImageDetails
          key={selected.id}
          f={selected}
          e={report.entries.find((x) => x.url === selected.url)}
          onClose={() => onPick(undefined)}
          onSeek={onSeek}
          onReveal={onReveal}
          wallClock={wallClock}
        />
      )}
    </>
  )
}

function ImageDetails({
  f,
  e,
  onClose,
  onSeek,
  onReveal,
  wallClock,
}: {
  f: ImageFinding
  e?: ImageEntry
  onClose: () => void
  onSeek?: (t: number) => void
  onReveal?: (request: string) => void
  wallClock?: (ms: number) => string
}) {
  const src = !e?.body
    ? undefined
    : e.body.base64
      ? `data:${e.body.mime || "image/png"};base64,${e.body.data}`
      : `data:${e.body.mime || "image/svg+xml"},${encodeURIComponent(e.body.data)}`
  const m = e?.measure
  const facts: [string, string][] = e
    ? [
        ["format", e.format.toUpperCase()],
        ["file", formatBytes(e.bytes)],
        ["natural size", size(e.natural)],
        ["drawn at most", e.needed ? `${size(e.needed)} device px` : "–"],
        ...(m?.webp !== undefined ? [[`WebP q${webpQuality * 100}`, formatBytes(m.webp)] as [string, string]] : []),
        ...(m?.resized ? [[`WebP at ${size(m.resized)}`, formatBytes(m.resized.webp)] as [string, string]] : []),
      ]
    : []
  const time = (t: number) =>
    onSeek ? (
      <TimeButton t={t} onSeek={onSeek} />
    ) : (
      <span className="w-24 shrink-0 font-mono text-[12px] text-stage-outline-dim tabular-nums">
        {wallClock ? wallClock(t) : ""}
      </span>
    )

  return (
    <Details onClose={onClose} title={<FindingTitle severity={f.severity} title={f.title} />}>
      <p className="text-sm text-stage-on-surface-variant">
        <Rich text={f.detail} />
      </p>
      {e && (
        <Section title="Image">
          <div className="flex gap-3">
            {src && (
              <img
                src={src}
                alt=""
                className="size-24 shrink-0 rounded-lg border border-stage-outline-variant/70 bg-[repeating-conic-gradient(#8882_0_25%,transparent_0_50%)] bg-[length:12px_12px] object-contain"
              />
            )}
            <div className="min-w-0 flex-1">
              <Pairs pairs={facts} />
            </div>
          </div>
          <p className="mt-1.5 truncate text-xs text-stage-outline" title={e.url}>
            {e.url}
          </p>
        </Section>
      )}
      {e && e.uses.length > 0 && (
        <Section title={`Drawn by · ${e.uses.length}`}>
          <div className="max-h-48 overflow-auto text-[12.5px]">
            {e.uses.map((u) => (
              <div
                key={`${u.target}/${u.frame}/${u.element}/${u.kind}`}
                className="flex items-center gap-2 px-2 py-[3px]"
              >
                {time(u.at)}
                <span className="w-28 shrink-0 text-stage-on-surface">{kindLabel[u.kind] ?? u.kind}</span>
                <span className="min-w-0 flex-1 truncate text-stage-on-surface-variant tabular-nums">
                  {size(u)} CSS px × {u.dpr}
                  {u.fit ? ` · ${u.fit}` : ""}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-xs",
                    u.shown ? "text-stage-primary" : u.hidden ? "text-stage-outline-dim" : "text-stage-amber",
                  )}
                >
                  {u.shown ? "on screen" : u.hidden ? "hidden" : "off screen"}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {e && (
        <Section
          title={`Requests · ${e.requests.length}`}
          aside={
            onReveal && (
              <button
                type="button"
                onClick={() => onReveal(e.requests.at(-1)!.key)}
                className="ml-auto text-xs font-normal tracking-normal text-stage-primary normal-case hover:underline"
              >
                Open in Network
              </button>
            )
          }
        >
          <div className="max-h-40 overflow-auto text-[12.5px]">
            {e.requests.map((r) => (
              <div key={r.key} className="flex items-center gap-2 px-2 py-[3px]">
                {time(r.at)}
                <span className="min-w-0 flex-1 truncate" title={r.url}>
                  {splitURL(r.url).name}
                </span>
                <span className="w-24 shrink-0 text-right text-xs text-stage-outline tabular-nums">
                  {r.cached ? `${r.cached} cache` : r.size ? formatBytes(r.size) : ""}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </Details>
  )
}
