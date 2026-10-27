import type { IPInfo } from "@/api/client"
import { cdnName, siteName } from "@/lib/routes"
import { countryFlag } from "@/lib/format"

/**
 * Where an address is, as the api placed it. A CDN's address is anycast:
 * the nearest of its sites answers, so it shows the site when it is known
 * and never the country the address is registered in.
 */
export function Place({ info, edge, short }: { info?: IPInfo; edge?: string; short?: boolean }) {
  if (!info) return <span className="text-muted-foreground">…</span>
  if (info.private) return <span className="text-muted-foreground">private network</span>
  const org = info.asn ? `AS${info.asn}${info.org ? ` ${info.org}` : ""}` : ""
  if (info.cdn) {
    const site = edge ? siteName(edge) : undefined
    return (
      <span
        className="flex min-w-0 items-baseline gap-1 overflow-hidden whitespace-nowrap"
        title={[
          `${cdnName(info.cdn)} anycast: the same address is announced from many sites and the nearest answers.`,
          edge ? `The site that answered: ${site ?? edge} (${edge}).` : "Which site answered isn't known.",
          info.country
            ? `The address is registered in ${info.country}, which says nothing about where it answers.`
            : "",
          org,
        ]
          .filter(Boolean)
          .join("\n")}
      >
        <span className="shrink-0 rounded-sm bg-sky-500/15 px-1 text-[10.5px] leading-4 text-sky-700 dark:text-sky-300">
          anycast
        </span>
        <span className={edge ? "shrink-0" : "truncate"}>{cdnName(info.cdn)}</span>
        {edge && (
          <span className="truncate">
            · {site ?? edge} <span className="font-mono text-muted-foreground">{edge}</span>
          </span>
        )}
      </span>
    )
  }
  return (
    <span
      className="flex min-w-0 items-baseline gap-1 overflow-hidden whitespace-nowrap"
      title={[info.country, org].filter(Boolean).join(" · ")}
    >
      {info.country ? (
        <span className="shrink-0">
          {countryFlag(info.country)} {info.country}
        </span>
      ) : (
        <span className="shrink-0 text-muted-foreground">?</span>
      )}
      {!short && org && <span className="truncate text-muted-foreground">{org}</span>}
    </span>
  )
}
