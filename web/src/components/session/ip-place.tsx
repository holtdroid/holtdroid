import type { IPInfo } from "@/api/client"
import { countryFlag } from "@/lib/format"

/** An address's country, CDN edge and network, as the api placed it. */
export function Place({ info, short }: { info?: IPInfo; short?: boolean }) {
  if (!info) return <span className="text-muted-foreground">…</span>
  if (info.private) return <span className="text-muted-foreground">private network</span>
  const org = info.asn ? `AS${info.asn}${info.org ? ` ${info.org}` : ""}` : ""
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1" title={[info.country, org].filter(Boolean).join(" · ")}>
      {info.country ? (
        <span className="shrink-0">
          {countryFlag(info.country)} {info.country}
        </span>
      ) : (
        <span className="shrink-0 text-muted-foreground">?</span>
      )}
      {info.cdn && (
        <span
          className="shrink-0 rounded-sm bg-sky-500/15 px-1 text-[10.5px] leading-4 text-sky-700 dark:text-sky-300"
          title="A CDN's anycast edge: the nearest of its sites answers, whatever country the address is listed in"
        >
          CDN
        </span>
      )}
      {!short && org && <span className="truncate text-muted-foreground">{org}</span>}
    </span>
  )
}
