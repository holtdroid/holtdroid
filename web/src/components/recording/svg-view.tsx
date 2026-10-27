import { Details, Section } from "@/components/recording/devtools-view"
import { FindingList, FindingTitle, Rich, Stat, Stats } from "@/components/recording/findings"
import { formatBytes } from "@/lib/format"
import { occurrences, type SvgFinding, type SvgPath, type SvgReport } from "@/lib/recording/svgpaths"
import { cn } from "@/lib/utils"

const shown = 100

/**
 * The SVG paths found in the WebViews' scripts, pages, stylesheets, SVG files
 * and inline SVGs, as findings about their size.
 */
export function SvgView({
  report,
  picked,
  onPick,
  onReveal,
  empty,
}: {
  report: SvgReport
  picked?: string
  onPick: (id: string | undefined) => void
  onReveal?: (request: string) => void
  empty: string
}) {
  const { summary: s, findings } = report
  const selected = picked ? findings.find((f) => f.id === picked) : undefined
  return (
    <>
      <Stats>
        <Stat label="Files" value={s.sources} />
        <Stat label="Paths" value={s.paths} />
        <Stat label="Path data" value={formatBytes(s.bytes)} />
        {s.saving > 0 && (
          <Stat
            label="Could save"
            value={formatBytes(s.saving)}
            title="Rounding, shorter commands and shipping each path once, before gzip or Brotli"
          />
        )}
      </Stats>
      {!s.optimized && s.paths > 0 && (
        <p className="px-4 pb-2 text-xs text-stage-outline">Working out shorter commands with svgo…</p>
      )}
      <FindingList
        findings={findings.map((f) => ({
          id: f.id,
          severity: f.severity,
          title: f.title,
          saving: f.saving,
          savingTitle: "Could save, before compression",
          count: f.paths.length,
          countTitle: "Paths",
        }))}
        picked={picked}
        onPick={onPick}
        empty={s.paths ? "Nothing to improve in these paths" : empty}
      />
      {selected && (
        <SvgDetails
          key={selected.id}
          f={selected}
          report={report}
          onClose={() => onPick(undefined)}
          onReveal={onReveal}
        />
      )}
    </>
  )
}

function SvgDetails({
  f,
  report,
  onClose,
  onReveal,
}: {
  f: SvgFinding
  report: SvgReport
  onClose: () => void
  onReveal?: (request: string) => void
}) {
  const source = report.sources.find((s) => s.source.key === f.source)?.source
  const request = source?.requests.at(-1)
  return (
    <Details onClose={onClose} title={<FindingTitle severity={f.severity} title={f.title} />}>
      <p className="text-sm text-stage-on-surface-variant">
        <Rich text={f.detail} />
      </p>
      {source && (
        <Section
          title="File"
          aside={
            onReveal &&
            request && (
              <button
                type="button"
                onClick={() => onReveal(request)}
                className="ml-auto text-xs font-normal tracking-normal text-stage-primary normal-case hover:underline"
              >
                Open in Network
              </button>
            )
          }
        >
          <p className="truncate text-sm text-stage-on-surface" title={source.url}>
            {source.url}
          </p>
        </Section>
      )}
      <Section title={`Paths · ${f.paths.length}${f.paths.length > shown ? `, the first ${shown}` : ""}`}>
        <div className="space-y-2">
          {f.paths.slice(0, shown).map((p) => (
            <PathRow key={`${p.source}/${p.offset}`} p={p} f={f} report={report} />
          ))}
        </div>
      </Section>
    </Details>
  )
}

function PathRow({ p, f, report }: { p: SvgPath; f: SvgFinding; report: SvgReport }) {
  const after = f.rule === "precision" ? p.rounded : f.rule === "encoding" ? p.optimized : undefined
  const where = f.rule === "duplicate" ? occurrences(report, p.d) : []
  return (
    <div className="flex gap-2 rounded-lg bg-stage-surface-container px-2 py-1.5">
      {p.viewBox && (
        <svg viewBox={p.viewBox.join(" ")} className="mt-0.5 size-6 shrink-0 text-stage-on-surface" aria-hidden>
          <path d={p.optimized || p.rounded} fill="currentColor" fillRule="evenodd" />
        </svg>
      )}
      <div className="min-w-0 flex-1 font-mono text-[11.5px] leading-[1.45]">
        <Code label={`${p.d.length} B`} text={p.d} />
        {after !== undefined && <Code label={`${after.length} B`} text={after} tone="text-stage-primary" />}
        {where.length > 0 && (
          <p className="mt-0.5 font-sans text-xs text-stage-outline">
            {where.length}× in {[...new Set(where.map((w) => w.source.label))].join(", ")}
          </p>
        )}
        <p className="font-sans text-[11px] text-stage-outline-dim">
          up to {p.decimals} decimals, {p.precision} needed for a size of {Math.round(p.extent * 100) / 100}
          {p.viewBox ? " (viewBox)" : ""}
        </p>
      </div>
    </div>
  )
}

function Code({ label, text, tone = "text-stage-on-surface-variant" }: { label: string; text: string; tone?: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 text-right text-stage-outline tabular-nums">{label}</span>
      <span className={cn("line-clamp-2 min-w-0 flex-1 break-all", tone)} title={text.length > 2000 ? undefined : text}>
        {text}
      </span>
    </div>
  )
}
