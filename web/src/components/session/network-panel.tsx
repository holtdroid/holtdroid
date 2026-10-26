import { ActivityIcon, RotateCcwIcon, SignalIcon, TriangleAlertIcon } from "lucide-react"
import { useState } from "react"
import type {
  DeviceState,
  NetworkLink,
  NetworkPath,
  NetworkProfileInfo,
  NetworkRegionInfo,
  NetworkRegionSettings,
  NetworkRoute,
  NetworkServerInfo,
} from "@/api/client"
import { useDevice, useUpdateDevice } from "@/components/session/use-device"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { countryFlag } from "@/lib/format"
import { lastBackends, rememberBackends } from "@/lib/launch-prefs"
import { cn } from "@/lib/utils"

const noRegion = "none"

/** Network conditions: the access link or a scenario, and a region's paths to CDNs and servers. */
export function NetworkPanel({ provider, id, pkg }: { provider: string; id: string; pkg: string }) {
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const s = device.data
  if (!s?.networkProfiles) {
    return (
      <div className="text-muted-foreground grid h-full place-items-center text-sm">
        {device.isPending ? <Spinner /> : "This device can't emulate network conditions."}
      </div>
    )
  }
  const busy = update.isPending
  const route = s.networkRoute
  const region = s.networkRegion
  const info = s.networkRegions?.find((r) => r.id === region?.region)
  const changed = (!!s.networkProfile && s.networkProfile !== "full") || !!region
  const setRegion = (patch: Partial<NetworkRegionSettings>) =>
    update.mutate({
      networkRegion: {
        region: region?.region ?? "",
        server: region?.server,
        backends: region ? region.backends : lastBackends(pkg),
        ...patch,
      },
    })

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto grid max-w-4xl gap-6 p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{summary(s, info)}</h3>
          {busy && <Spinner className="size-3.5" />}
          {changed && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              disabled={busy}
              onClick={() => update.mutate({ networkProfile: "full", networkRegion: { region: "" } })}
            >
              <RotateCcwIcon /> No emulation
            </Button>
          )}
        </div>

        <Route route={route} servers={s.networkServers ?? []} />

        {s.networkRegions && (
          <section className="grid gap-3">
            <Heading
              title="Region"
              note="Where the app's users are: the round trips from their mobile operators to the CDN edge and to your servers, on top of the access link below."
            />
            <div className="flex flex-wrap gap-2">
              <Select
                value={region?.region ?? noRegion}
                disabled={busy}
                onValueChange={(v) => setRegion({ region: v === noRegion ? "" : v })}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={noRegion}>No region</SelectItem>
                  {s.networkRegions.map((r) => {
                    const slow = regionIssues(r, route, region?.server ?? s.networkServers?.[0]?.id ?? "")
                    return (
                      <SelectItem key={r.id} value={r.id}>
                        {countryFlag(r.country)} {r.name}
                        {slow.length > 0 && (
                          <span className="ml-auto pl-3 text-xs text-amber-700 dark:text-amber-400">
                            VPN slower: {slow.join(", ")}
                          </span>
                        )}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              {region && (
                <Select value={region.server} disabled={busy} onValueChange={(server) => setRegion({ server })}>
                  <SelectTrigger className="w-56">
                    <span className="text-muted-foreground">Servers in</span>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {s.networkServers?.map((srv) => {
                      const theirs = info?.servers.find((x) => x.server === srv.id)?.rtt
                      const mine = route?.servers?.find((x) => x.server === srv.id)?.rtt
                      return (
                        <SelectItem key={srv.id} value={srv.id}>
                          {srv.name}
                          <span className="text-muted-foreground ml-auto pl-3 font-mono text-xs">
                            {theirs} ms
                            {mine && theirs && mine > theirs && (
                              <span className="text-amber-700 dark:text-amber-400"> · VPN {mine} ms</span>
                            )}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              )}
            </div>
            {info && <p className="text-muted-foreground text-xs">{info.description}</p>}
            {region && info && (
              <>
                <Paths
                  paths={region.paths}
                  info={info}
                  server={s.networkServers?.find((x) => x.id === region.server)?.name ?? region.server}
                  measuring={!route}
                />
                <Backends
                  key={(region.backends ?? []).join("\n")}
                  backends={region.backends ?? []}
                  addresses={region.addresses ?? []}
                  busy={busy}
                  onSave={(backends) => {
                    rememberBackends(pkg, backends)
                    setRegion({ backends })
                  }}
                />
              </>
            )}
          </section>
        )}

        <Profiles
          profiles={s.networkProfiles}
          current={s.networkProfile}
          region={info}
          route={route}
          busy={busy}
          onChange={(networkProfile) => update.mutate({ networkProfile })}
        />
      </div>
    </div>
  )
}

export function summary(s: DeviceState, info?: NetworkRegionInfo) {
  const profile = s.networkProfiles?.find((p) => p.id === s.networkProfile)
  const link = profile && profile.id !== "full" ? profile.name : info ? "typical mobile" : "No emulation"
  return info ? `${countryFlag(info.country)} ${info.name} · ${link}` : link
}

function Route({ route, servers }: { route?: NetworkRoute; servers: NetworkServerInfo[] }) {
  const name = (id: string) => servers.find((x) => x.id === id)?.name ?? id
  return (
    <section className="bg-muted/40 grid gap-1 rounded-lg border px-3 py-2 text-xs">
      <span className="font-medium">The session&apos;s own route, through its VPN location</span>
      {route ? (
        <>
          <span className="font-mono">
            {[route.edge && `CDN edge ${route.edge} ms`, route.down && `↓ ${bandwidth(route.down)}`]
              .filter(Boolean)
              .join(" · ") || "CDN edge and bandwidth not measured"}
          </span>
          {route.servers && route.servers.length > 0 && (
            <span className="text-muted-foreground font-mono">
              {route.servers.map((x) => `${name(x.server)} ${x.rtt} ms`).join(" · ")}
            </span>
          )}
          <span className="text-muted-foreground">
            Every emulated network comes on top of it: a profile adds its delay to these, and can&apos;t get faster than
            the route&apos;s bandwidth. Measured every minute, the bandwidth after a location change.
          </span>
        </>
      ) : (
        <span className="text-muted-foreground flex items-center gap-1.5">
          <Spinner className="size-3" /> Measuring…
        </span>
      )}
    </section>
  )
}

function regionIssues(r: NetworkRegionInfo, route: NetworkRoute | undefined, server: string) {
  if (!route) return []
  const mine = route.servers?.find((x) => x.server === server)?.rtt
  const theirs = r.servers.find((x) => x.server === server)?.rtt
  return [
    !!route.edge && route.edge > r.edgeRtt && "CDN",
    !!mine && !!theirs && mine > theirs && "servers",
    !!route.down && !!r.access.down && r.access.down > route.down && "bandwidth",
  ].filter((x) => typeof x === "string")
}

function profileNotes(link: NetworkLink | NetworkProfileInfo, route: NetworkRoute | undefined, delay: boolean) {
  if (!route) return []
  return [
    delay &&
      !!route.edge &&
      !!link.rtt &&
      route.edge > link.rtt &&
      `The VPN route's ${route.edge} ms is more than this network's own ${link.rtt} ms`,
    !!route.down && !!link.down && link.down > route.down && `Capped at about ${bandwidth(route.down)} by the VPN`,
  ].filter((x) => typeof x === "string")
}

function Heading({ title, note }: { title: string; note: string }) {
  return (
    <div className="grid gap-0.5">
      <h4 className="text-sm font-medium">{title}</h4>
      <p className="text-muted-foreground text-xs">{note}</p>
    </div>
  )
}

function Paths({
  paths,
  info,
  server,
  measuring,
}: {
  paths: NetworkPath[]
  info: NetworkRegionInfo
  server: string
  measuring: boolean
}) {
  const label = (p: NetworkPath) =>
    p.class === "edge"
      ? { title: "CDN edge and DNS", detail: `Cloudflare, Fastly and Google, served from ${info.edge}` }
      : { title: `Servers in ${server}`, detail: "Your backends and everything not on a CDN" }
  const over = paths.filter((p) => p.baseline && p.baseline > p.target)
  return (
    <div className="grid gap-2">
      <div className="overflow-hidden rounded-lg border text-xs">
        <div className="bg-muted/50 text-muted-foreground grid grid-cols-[minmax(0,1fr)_6rem_7rem_6rem] gap-2 px-3 py-1.5">
          <span>Path</span>
          <span className="text-right">In the region</span>
          <span className="text-right">Session route</span>
          <span className="text-right">Added</span>
        </div>
        {paths.map((p) => {
          const l = label(p)
          return (
            <div
              key={p.class}
              className="grid grid-cols-[minmax(0,1fr)_6rem_7rem_6rem] items-center gap-2 border-t px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block font-medium">{l.title}</span>
                <span className="text-muted-foreground block truncate">{l.detail}</span>
              </span>
              <span className="text-right font-mono">{p.target} ms</span>
              <span
                className={cn(
                  "text-right font-mono",
                  p.baseline && p.baseline > p.target && "text-amber-600 dark:text-amber-400",
                )}
              >
                {measuring ? <Spinner className="ml-auto size-3" /> : p.baseline ? `${p.baseline} ms` : "not measured"}
              </span>
              <span className="text-right font-mono">+{p.added} ms</span>
            </div>
          )
        })}
      </div>
      <p className="text-muted-foreground text-xs">
        The session&apos;s own route (through its VPN location) already takes some time; only the rest is added, on top
        of the access link&apos;s round trip. It is measured again every minute and after a location change.
      </p>
      {over.length > 0 && (
        <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
          {over.map((p) => label(p).title).join(" and ")}: the session&apos;s route is already slower than in{" "}
          {info.name}, and emulation can only add delay. A VPN location closer to the servers, or none, gets nearer.
        </p>
      )}
    </div>
  )
}

function Backends({
  backends,
  addresses,
  busy,
  onSave,
}: {
  backends: string[]
  addresses: string[]
  busy: boolean
  onSave: (backends: string[]) => void
}) {
  const [draft, setDraft] = useState(backends.join("\n"))
  const parsed = draft
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean)
  const dirty = parsed.join("\n") !== backends.join("\n")
  return (
    <div className="grid gap-1.5">
      <Heading
        title="Backends behind a CDN"
        note="Host names, or *.example.com for every name below it, whose traffic goes through to your servers even though a CDN fronts them, such as an API on Cloudflare. They are matched by the addresses the device gets when it looks them up; other hosts on the same CDN addresses take the servers' path too. Saved for this app in this browser."
      />
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={"api.example.com\n*.example.com"}
        rows={2}
        className="font-mono text-xs"
      />
      {addresses.length > 0 && (
        <p className="text-muted-foreground font-mono text-[11px]">
          {addresses.length === 1 ? "1 address" : `${addresses.length} addresses`}: {addresses.join(", ")}
        </p>
      )}
      {dirty && (
        <Button size="sm" className="justify-self-start" disabled={busy} onClick={() => onSave(parsed)}>
          Save backends
        </Button>
      )}
    </div>
  )
}

function Profiles({
  profiles,
  current,
  region,
  route,
  busy,
  onChange,
}: {
  profiles: NetworkProfileInfo[]
  current?: string
  region?: NetworkRegionInfo
  route?: NetworkRoute
  busy: boolean
  onChange: (id: string) => void
}) {
  const groups = [
    {
      title: "Access link",
      note: "The device's own connection: latency, bandwidth and loss on every request.",
      items: profiles.filter((p) => !p.scenario),
    },
    { title: "Scenarios", note: "The access link changes over time.", items: profiles.filter((p) => p.scenario) },
  ]
  return groups.map(
    (g) =>
      g.items.length > 0 && (
        <section key={g.title} className="grid gap-3">
          <Heading title={g.title} note={g.note} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
            {g.items.map((p) => {
              const typical = p.id === "full" && region
              const link = typical ? region.access : p
              const numbers = linkNumbers(link)
              const notes = p.scenario ? [] : profileNotes(link, route, !region)
              const expected =
                !region && !p.scenario && route?.edge ? `≈ ${route.edge + (p.rtt ?? 0)} ms to a CDN edge` : undefined
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  onClick={() => p.id !== current && onChange(p.id)}
                  className={cn(
                    "hover:bg-muted/60 grid gap-1 rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
                    p.id === current && "border-primary bg-primary/5 hover:bg-primary/5",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {p.scenario ? <ActivityIcon className="size-3.5" /> : <SignalIcon className="size-3.5" />}
                    {typical ? `Typical mobile in ${region.name}` : p.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {typical ? "The region's median mobile connection." : p.description}
                  </span>
                  {numbers && <span className="text-muted-foreground font-mono text-[11px]">{numbers}</span>}
                  {expected && <span className="text-muted-foreground font-mono text-[11px]">{expected}</span>}
                  {notes.map((n) => (
                    <span key={n} className="flex gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                      <TriangleAlertIcon className="mt-px size-3 shrink-0" />
                      {n}
                    </span>
                  ))}
                </button>
              )
            })}
          </div>
        </section>
      ),
  )
}

export function linkNumbers(p: NetworkLink | NetworkProfileInfo) {
  return [
    p.rtt && `+${p.rtt}${p.jitter ? ` ±${p.jitter}` : ""} ms`,
    (p.down || p.up) && `↓ ${bandwidth(p.down)} ↑ ${bandwidth(p.up)}`,
    p.loss && `${p.loss}% loss`,
  ]
    .filter(Boolean)
    .join(" · ")
}

function bandwidth(kbit?: number) {
  if (!kbit) return "∞"
  return kbit >= 1000 ? `${kbit / 1000} Mbit/s` : `${kbit} kbit/s`
}
