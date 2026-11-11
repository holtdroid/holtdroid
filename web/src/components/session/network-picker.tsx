import { PlayIcon, RepeatIcon, RotateCcwIcon, SearchIcon, SignalIcon, TriangleAlertIcon, XIcon } from "lucide-react"
import { type CSSProperties, type KeyboardEvent, useState } from "react"
import type {
  DeviceState,
  NetworkPath,
  NetworkProfileInfo,
  NetworkRegionInfo,
  NetworkRegionSettings,
  NetworkRoute,
  NetworkServerInfo,
} from "@/api/client"
import { useNetworkBackends, useSaveNetworkBackends } from "@/api/queries"
import { SectionTitle } from "@/components/session/shade"
import { useDevice, useUpdateDevice } from "@/components/session/use-device"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useNow } from "@/hooks/use-now"
import { countryFlag } from "@/lib/format"
import { lastBackends, rememberBackends } from "@/lib/launch-prefs"
import {
  bandwidth,
  emulating,
  hold,
  linkNumbers,
  loop,
  mbit,
  type NetworkStep,
  position,
  type Position,
  profileNotes,
  quality,
  qualityFill,
  regionIssues,
  seconds,
  speed,
  stepLink,
  stepName,
  summary,
} from "@/lib/network-conditions"
import { cn } from "@/lib/utils"

export type NetworkTab = "networks" | "scenarios" | "region"

export function NetworkPicker({
  provider,
  id,
  pkg,
  location,
  open,
  onOpenChange,
  tab,
  onTab,
}: {
  provider: string
  id: string
  pkg: string
  location?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: NetworkTab
  onTab: (tab: NetworkTab) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1080px]"
      >
        {open && <Picker provider={provider} id={id} pkg={pkg} location={location} tab={tab} onTab={onTab} />}
      </DialogContent>
    </Dialog>
  )
}

function Picker({
  provider,
  id,
  pkg,
  location,
  tab,
  onTab,
}: {
  provider: string
  id: string
  pkg: string
  location?: string
  tab: NetworkTab
  onTab: (tab: NetworkTab) => void
}) {
  const device = useDevice(provider, id)
  const update = useUpdateDevice(provider, id)
  const s = device.data
  const header = (
    <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
      <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] border bg-muted">
        <SignalIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <DialogTitle className="text-[17px] font-semibold">Network conditions</DialogTitle>
        <DialogDescription className="text-xs">
          For the whole device: every app, the WebView, DNS.{" "}
          {location ? `On top of the VPN route through ${location}.` : "On top of the session's own route."}
        </DialogDescription>
      </div>
      {s && <Current s={s} />}
      {s?.networkProfiles && (
        <Button
          variant="outline"
          disabled={!emulating(s) || update.isPending}
          onClick={() => update.mutate({ networkProfile: "full", networkRegion: { region: "" } })}
        >
          <RotateCcwIcon />
          No emulation
        </Button>
      )}
      <DialogClose asChild>
        <Button variant="outline" size="icon" aria-label="Close">
          <XIcon />
        </Button>
      </DialogClose>
    </div>
  )
  if (!s?.networkProfiles) {
    return (
      <>
        {header}
        <div className="grid min-h-60 place-items-center text-sm text-muted-foreground">
          {device.isPending ? <Spinner /> : "This device can't emulate network conditions."}
        </div>
      </>
    )
  }
  const links = s.networkProfiles.filter((p) => !p.scenario)
  const scenarios = s.networkProfiles.filter((p) => p.scenario)
  const info = s.networkRegions?.find((r) => r.id === s.networkRegion?.region)
  const busy = update.isPending
  const set = (networkProfile: string) => update.mutate({ networkProfile })

  return (
    <>
      {header}
      <Tabs value={tab} onValueChange={(v) => onTab(v as NetworkTab)} className="min-h-0 flex-1 gap-0">
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          <TabsList>
            <TabsTrigger value="networks">
              Networks <Count n={links.length} />
            </TabsTrigger>
            <TabsTrigger value="scenarios">
              Scenarios <Count n={scenarios.length} />
            </TabsTrigger>
            {s.networkRegions && (
              <TabsTrigger value="region">
                Region <Count n={s.networkRegions.length} />
              </TabsTrigger>
            )}
          </TabsList>
          {busy && <Spinner className="size-3.5" />}
          <span className="flex-1" />
          <RouteBadges route={s.networkRoute} servers={s.networkServers ?? []} />
        </div>
        <TabsContent value="networks" className="min-h-0 overflow-auto">
          <Networks links={links} s={s} info={info} busy={busy} onPick={set} />
        </TabsContent>
        <TabsContent value="scenarios" className="min-h-0 overflow-auto">
          <Scenarios scenarios={scenarios} s={s} busy={busy} onStart={set} />
        </TabsContent>
        {s.networkRegions && (
          <TabsContent value="region" className="min-h-0 overflow-auto">
            <Region s={s} regions={s.networkRegions} info={info} pkg={pkg} provider={provider} id={id} />
          </TabsContent>
        )}
      </Tabs>
    </>
  )
}

function Count({ n }: { n: number }) {
  return (
    <span className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full border px-[5px] text-[11px] text-muted-foreground">
      {n}
    </span>
  )
}

function Current({ s }: { s: DeviceState }) {
  const now = useNow()
  const profile = s.networkProfiles?.find((p) => p.id === s.networkProfile)
  const pos = position(s, now)
  if (profile && pos) {
    return (
      <Badge variant="warning">
        <RepeatIcon />
        {profile.name} · step {pos.step + 1} of {pos.count}
      </Badge>
    )
  }
  if (!emulating(s)) return null
  return (
    <Badge variant="secondary">
      {summary(
        s,
        s.networkRegions?.find((r) => r.id === s.networkRegion?.region),
      )}
    </Badge>
  )
}

function RouteBadges({ route, servers }: { route?: NetworkRoute; servers: NetworkServerInfo[] }) {
  const nearest = route?.servers?.toSorted((a, b) => a.rtt - b.rtt)[0]
  return (
    <span
      className="flex flex-wrap items-center gap-1.5"
      title="Every emulated network comes on top of the session's own route through its VPN location: a profile adds its delay to these round trips and can't get faster than the route's bandwidth."
    >
      <span className="text-xs text-muted-foreground">Session route</span>
      {route ? (
        <>
          {route.edge && (
            <Badge variant="secondary" className="font-mono">
              CDN {route.edge} ms
            </Badge>
          )}
          {nearest && (
            <Badge variant="secondary" className="font-mono">
              {servers.find((x) => x.id === nearest.server)?.name ?? nearest.server} {nearest.rtt} ms
            </Badge>
          )}
          {route.down && (
            <Badge variant="secondary" className="font-mono">
              ↓ {bandwidth(route.down)}
            </Badge>
          )}
        </>
      ) : (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner className="size-3" /> Measuring…
        </span>
      )}
    </span>
  )
}

const linkGrid =
  "grid grid-cols-[22px_minmax(0,1fr)_88px] items-center gap-3 sm:grid-cols-[22px_minmax(0,1.4fr)_100px_140px_60px_minmax(0,1fr)]"

function radioKeys(e: KeyboardEvent<HTMLElement>) {
  const move = ({ ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 } as Record<string, number>)[e.key]
  if (!move) return
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')]
  const next = radios[(radios.indexOf(document.activeElement as HTMLElement) + move + radios.length) % radios.length]
  if (!next) return
  e.preventDefault()
  next.focus()
  next.click()
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "box-border size-4 shrink-0 rounded-full border-[1.5px] border-muted-foreground",
        on && "border-[5px] border-foreground",
      )}
    />
  )
}

function Networks({
  links,
  s,
  info,
  busy,
  onPick,
}: {
  links: NetworkProfileInfo[]
  s: DeviceState
  info?: NetworkRegionInfo
  busy: boolean
  onPick: (id: string) => void
}) {
  const [filter, setFilter] = useState("")
  const q = filter.trim().toLowerCase()
  const shown = links.filter((p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q))
  const route = s.networkRoute
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2.5 px-5 pt-3">
        <div className="grid min-w-0 flex-1">
          <SectionTitle>Access link</SectionTitle>
          <span className="text-xs text-muted-foreground">
            The device&apos;s own connection: latency, bandwidth and loss on every request.
          </span>
        </div>
        <label className="flex h-[30px] w-56 items-center gap-2 rounded-[10px] border bg-muted px-3 text-muted-foreground">
          <SearchIcon className="size-3.5" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter"
            aria-label="Filter networks"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none"
          />
        </label>
      </div>
      <div className="p-2" role="radiogroup" aria-label="Networks" onKeyDown={radioKeys}>
        <div className={cn(linkGrid, "h-[30px] px-3 text-xs text-muted-foreground")}>
          <span />
          <span>Network</span>
          <span>RTT, ms</span>
          <span className="max-sm:hidden">Down / up, kbit/s</span>
          <span className="max-sm:hidden">Loss</span>
          <span className="max-sm:hidden">Speed</span>
        </div>
        {shown.map((p, i) => {
          const typical = p.id === "full" && info
          const link = typical ? info.access : p
          const on = p.id === s.networkProfile
          const notes = profileNotes(link, route, !info)
          const score = p.id === "full" && !info ? 1 : speed(link)
          const expected = !info && route?.edge ? `≈ ${route.edge + (p.rtt ?? 0)} ms to a CDN edge` : undefined
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={busy}
              tabIndex={on || (i === 0 && !shown.some((x) => x.id === s.networkProfile)) ? 0 : -1}
              onClick={() => !on && !busy && onPick(p.id)}
              className={cn(
                linkGrid,
                "min-h-11 w-full cursor-pointer rounded-[9px] px-3 py-1.5 text-left text-[13px] transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 aria-disabled:cursor-default",
                on && "bg-muted shadow-[inset_0_0_0_1px_var(--border)]",
              )}
            >
              <Radio on={on} />
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{typical ? `Typical mobile in ${info.name}` : p.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {typical ? "The region's median mobile connection." : p.description}
                </span>
                {notes.map((n) => (
                  <span key={n} className="flex items-center gap-1 text-[11px] text-warning">
                    <TriangleAlertIcon className="size-3 shrink-0" />
                    <span className="truncate">{n}</span>
                  </span>
                ))}
              </span>
              <span className="font-mono" title={expected}>
                {link.rtt ? `${link.rtt}${link.jitter ? ` ± ${link.jitter}` : ""}` : "—"}
              </span>
              <span className="font-mono max-sm:hidden">
                {link.down || link.up ? `${link.down ?? "∞"} / ${link.up ?? "∞"}` : "unlimited"}
              </span>
              <span
                className="font-mono max-sm:hidden"
                title={"burst" in link && link.burst ? `Lost in runs of about ${link.burst} packets` : undefined}
              >
                {link.loss ? `${link.loss}%` : "—"}
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-border max-sm:hidden">
                <span
                  className={cn("block h-full", qualityFill[quality(score)])}
                  style={{ width: `${Math.round(score * 100)}%` }}
                />
              </span>
            </button>
          )
        })}
        {shown.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No network matches “{filter}”</p>
        )}
      </div>
    </div>
  )
}

const outage: CSSProperties = {
  background: "repeating-linear-gradient(135deg, var(--danger) 0 3px, transparent 3px 7px)",
}

function Strip({
  scenario,
  profiles,
  current,
}: {
  scenario: NetworkProfileInfo
  profiles: NetworkProfileInfo[]
  current?: number
}) {
  const steps = scenario.steps ?? []
  return (
    <div className="flex h-[22px] gap-0.5" aria-hidden>
      {steps.map((st, i) => (
        <span
          key={i}
          style={{ flex: (st.min + st.max) / 2, ...(st.profile ? undefined : outage) }}
          className={cn(
            "flex min-w-1 items-center overflow-hidden rounded-[5px] px-1.5 text-[10.5px] font-medium whitespace-nowrap",
            st.profile ? "bg-accent text-foreground" : "border border-danger text-danger",
            i === current && "outline-2 outline-info",
          )}
        >
          {st.profile ? `${stepName(profiles, st, scenario)} ${hold(st)}` : hold(st)}
        </span>
      ))}
    </div>
  )
}

function Scenarios({
  scenarios,
  s,
  busy,
  onStart,
}: {
  scenarios: NetworkProfileInfo[]
  s: DeviceState
  busy: boolean
  onStart: (id: string) => void
}) {
  const profiles = s.networkProfiles ?? []
  const running = scenarios.find((p) => p.id === s.networkProfile)
  const now = useNow(running ? 1000 : 3_600_000)
  const [picked, setPicked] = useState(running?.id)
  const selected = scenarios.find((p) => p.id === picked) ?? running ?? scenarios[0]
  const pos = position(s, now)
  if (!selected) return <p className="p-6 text-sm text-muted-foreground">No scenarios on this device.</p>
  return (
    <div className="flex min-h-[460px] flex-wrap">
      <div className="grid min-w-0 flex-[999_1_520px] grid-cols-1 content-start gap-2.5 px-5 py-4 sm:grid-cols-2">
        {scenarios.map((p) => {
          const l = loop(p.steps ?? [])
          const on = p.id === s.networkProfile
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === selected.id}
              onClick={() => setPicked(p.id)}
              className={cn(
                "flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-card p-3.5 text-left transition-colors hover:bg-muted/50",
                p.id === selected.id && "border-foreground shadow-[inset_0_0_0_1px_var(--foreground)]",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="font-semibold">{p.name}</span>
                {on && (
                  <Badge variant="success" dot>
                    Running
                  </Badge>
                )}
                <span className="flex-1" />
                <span className="font-mono text-xs text-muted-foreground">{l.text} ↻</span>
              </span>
              <span className="line-clamp-2 text-[13px] text-muted-foreground">{p.description}</span>
              <Strip scenario={p} profiles={profiles} current={on && pos ? pos.step : undefined} />
              <span className="flex justify-between font-mono text-xs text-muted-foreground">
                <span>0 s</span>
                <span>{l.min === l.max ? `${seconds(l.mean)} s` : `≈ ${seconds(l.mean)} s`}</span>
              </span>
            </button>
          )
        })}
      </div>
      <ScenarioDetail
        scenario={selected}
        profiles={profiles}
        pos={selected.id === s.networkProfile ? pos : null}
        busy={busy}
        onStart={() => onStart(selected.id)}
      />
    </div>
  )
}

function stepNumbers(link: NetworkProfileInfo | undefined, st: NetworkStep) {
  if (!st.profile) return { rtt: "—", bw: "100% loss" }
  if (!link) return { rtt: "—", bw: "—" }
  return {
    rtt: link.rtt ? `${link.rtt}${link.jitter ? ` ± ${link.jitter}` : ""}` : "—",
    bw: link.down || link.up ? `${mbit(link.down)} / ${mbit(link.up)} M` : "unlimited",
  }
}

function ScenarioDetail({
  scenario,
  profiles,
  pos,
  busy,
  onStart,
}: {
  scenario: NetworkProfileInfo
  profiles: NetworkProfileInfo[]
  pos: Position | null
  busy: boolean
  onStart: () => void
}) {
  const steps = scenario.steps ?? []
  const current = pos ? steps[pos.step] : undefined
  const next = pos ? steps[pos.next] : undefined
  return (
    <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5 border-l bg-muted px-5 py-4 max-sm:border-t max-sm:border-l-0">
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-semibold">{scenario.name}</span>
        <Badge variant="secondary">Loops</Badge>
      </div>
      <p className="text-[13px] leading-normal text-muted-foreground">
        {scenario.description} Each step is held for a random time in its range.
      </p>
      <div className="overflow-hidden rounded-2xl border bg-card">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="h-8 border-b text-left text-xs text-muted-foreground">
              <th className="px-2.5 font-medium">Step</th>
              <th className="px-2.5 font-medium">Link</th>
              <th className="px-2.5 text-right font-medium">RTT</th>
              <th className="px-2.5 text-right font-medium">Down / up</th>
              <th className="px-2.5 text-right font-medium">Hold</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((st, i) => {
              const link = st.profile === scenario.id ? scenario : stepLink(profiles, st)
              const n = stepNumbers(link, st)
              const on = pos?.step === i
              return (
                <tr
                  key={i}
                  className={cn("h-[30px] border-b border-border-subtle last:border-b-0", on && "bg-info-soft")}
                >
                  <td className="px-2.5 font-mono">{i + 1}</td>
                  <td className={cn("px-2.5", !st.profile && "text-danger")}>
                    <span className="flex items-center gap-1.5">
                      {st.profile === scenario.id ? "Own link" : stepName(profiles, st)}
                      {on && <span className="size-1.5 rounded-full bg-info" />}
                    </span>
                  </td>
                  <td className="px-2.5 text-right font-mono">{n.rtt}</td>
                  <td className="px-2.5 text-right font-mono whitespace-nowrap">{n.bw}</td>
                  <td className="px-2.5 text-right font-mono whitespace-nowrap">{hold(st)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pos && current && next && (
        <div className="grid gap-2">
          <SectionTitle>
            Step {pos.step + 1} · {stepName(profiles, current, scenario)}
          </SectionTitle>
          <div className="h-1 overflow-hidden rounded-full bg-border">
            <div className="h-full bg-info" style={{ width: `${Math.round(pos.progress * 100)}%` }} />
          </div>
          <span className="text-xs text-muted-foreground">
            {seconds(pos.elapsed)} s of {hold(current)}, then {stepName(profiles, next, scenario)}
          </span>
        </div>
      )}
      {steps.some((st) => !st.profile) && (
        <div className="flex gap-3 rounded-xl bg-warning-soft px-4 py-3 text-[13px] leading-normal">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            An outage drops packets while Android still sees a network. For “no network” use Airplane mode in the
            Network row.
          </div>
        </div>
      )}
      <div className="mt-auto flex gap-2">
        <DialogClose asChild>
          <Button variant="outline" className="flex-1">
            Cancel
          </Button>
        </DialogClose>
        <Button className="flex-1" disabled={busy} onClick={onStart}>
          <PlayIcon />
          {pos ? "Restart scenario" : "Start scenario"}
        </Button>
      </div>
    </aside>
  )
}

function Region({
  s,
  regions,
  info,
  pkg,
  provider,
  id,
}: {
  s: DeviceState
  regions: NetworkRegionInfo[]
  info?: NetworkRegionInfo
  pkg: string
  provider: string
  id: string
}) {
  const update = useUpdateDevice(provider, id)
  const saved = useNetworkBackends(pkg)
  const save = useSaveNetworkBackends(pkg)
  const busy = update.isPending
  const route = s.networkRoute
  const region = s.networkRegion
  const server = region?.server || s.networkServers?.[0]?.id || ""
  const setRegion = (patch: Partial<NetworkRegionSettings>) =>
    update.mutate({
      networkRegion: {
        region: region?.region ?? "",
        server: region?.server,
        backends: region ? region.backends : saved.data?.persistent ? saved.data.backends : lastBackends(pkg),
        ...patch,
      },
    })

  return (
    <div className="flex min-h-[460px] flex-wrap">
      <div className="grid min-w-0 flex-[999_1_480px] content-start gap-1 px-3 py-3">
        <div className="grid px-2 pb-1">
          <SectionTitle>Region</SectionTitle>
          <span className="text-xs text-muted-foreground">
            Where the app&apos;s users are: the round trips from their mobile operators to the CDN edge and to your
            servers, on top of the access link.
          </span>
        </div>
        <div role="radiogroup" aria-label="Region" className="grid gap-0.5" onKeyDown={radioKeys}>
          <RegionRow
            on={!region}
            busy={busy}
            title="No region"
            detail="Only the access link"
            onPick={() => setRegion({ region: "" })}
          />
          {regions.map((r) => {
            const slow = regionIssues(r, route, server)
            return (
              <RegionRow
                key={r.id}
                on={region?.region === r.id}
                busy={busy}
                title={`${countryFlag(r.country)} ${r.name}`}
                detail={`${linkNumbers(r.access)} · ${r.edge} ${r.edgeRtt} ms`}
                warning={slow.length > 0 ? `VPN slower: ${slow.join(", ")}` : undefined}
                onPick={() => setRegion({ region: r.id })}
              />
            )
          })}
        </div>
      </div>
      <aside className="flex min-w-0 flex-[1_1_360px] flex-col gap-4 border-l bg-muted px-5 py-4 max-sm:border-t max-sm:border-l-0">
        {region && info ? (
          <>
            <div className="grid gap-1">
              <span className="text-[15px] font-semibold">
                {countryFlag(info.country)} {info.name}
              </span>
              <p className="text-[13px] text-muted-foreground">{info.description}</p>
            </div>
            <section className="grid gap-1.5">
              <SectionTitle>Servers in</SectionTitle>
              <div
                className="grid grid-cols-2 gap-1.5"
                role="radiogroup"
                aria-label="Server location"
                onKeyDown={radioKeys}
              >
                {s.networkServers?.map((srv) => {
                  const theirs = info.servers.find((x) => x.server === srv.id)?.rtt
                  const mine = route?.servers?.find((x) => x.server === srv.id)?.rtt
                  const on = srv.id === server
                  return (
                    <button
                      key={srv.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-disabled={busy}
                      tabIndex={on ? 0 : -1}
                      onClick={() => !on && !busy && setRegion({ server: srv.id })}
                      className={cn(
                        "grid cursor-pointer gap-0.5 rounded-[9px] border bg-card px-3 py-2 text-left text-[13px] transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 aria-disabled:cursor-default",
                        on && "border-primary bg-primary text-primary-foreground hover:bg-primary",
                      )}
                    >
                      <span className="font-medium">{srv.name}</span>
                      <span
                        className={cn("font-mono text-xs", on ? "text-primary-foreground/75" : "text-muted-foreground")}
                      >
                        {theirs} ms
                        {mine && theirs && mine > theirs && (
                          <span className={on ? undefined : "text-warning"}> · VPN {mine} ms</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
            <Paths
              paths={region.paths}
              info={info}
              server={s.networkServers?.find((x) => x.id === server)?.name ?? server}
              measuring={!route}
            />
            <Backends
              key={(region.backends ?? []).join("\n")}
              backends={region.backends ?? []}
              addresses={region.addresses ?? []}
              busy={busy}
              persistent={!!saved.data?.persistent}
              onSave={(backends) => {
                if (saved.data?.persistent) save.mutate(backends)
                else rememberBackends(pkg, backends)
                setRegion({ backends })
              }}
            />
          </>
        ) : (
          <Route route={route} servers={s.networkServers ?? []} />
        )}
      </aside>
    </div>
  )
}

function RegionRow({
  on,
  busy,
  title,
  detail,
  warning,
  onPick,
}: {
  on: boolean
  busy: boolean
  title: string
  detail: string
  warning?: string
  onPick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-disabled={busy}
      tabIndex={on ? 0 : -1}
      onClick={() => !on && !busy && onPick()}
      className={cn(
        "grid min-h-11 w-full cursor-pointer grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3 rounded-[9px] px-3 py-1.5 text-left text-[13px] transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 aria-disabled:cursor-default",
        on && "bg-muted shadow-[inset_0_0_0_1px_var(--border)]",
      )}
    >
      <Radio on={on} />
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{title}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{detail}</span>
      </span>
      {warning && <Badge variant="warning">{warning}</Badge>}
    </button>
  )
}

function ago(now: number, at?: string) {
  if (!at) return ""
  const min = Math.round((now - Date.parse(at)) / 60_000)
  if (min < 2) return ""
  return min < 120 ? `${min} min ago` : `${Math.round(min / 60)} h ago`
}

function Route({ route, servers }: { route?: NetworkRoute; servers: NetworkServerInfo[] }) {
  const now = useNow(30_000)
  const name = (id: string) => servers.find((x) => x.id === id)?.name ?? id
  const rttAge = ago(now, route?.at)
  const downAge = ago(now, route?.downAt)
  return (
    <section className="grid gap-1.5 text-xs">
      <SectionTitle>The session&apos;s own route</SectionTitle>
      {route ? (
        <>
          <span className="font-mono">
            {[
              route.edge && `CDN edge ${route.edge} ms${rttAge && ` (${rttAge})`}`,
              route.down && `↓ ${bandwidth(route.down)}${downAge && ` (${downAge})`}`,
            ]
              .filter(Boolean)
              .join(" · ") || "CDN edge and bandwidth not measured"}
          </span>
          {route.servers && route.servers.length > 0 && (
            <span className="font-mono text-muted-foreground">
              {route.servers.map((x) => `${name(x.server)} ${x.rtt} ms`).join(" · ")}
            </span>
          )}
          <span className="leading-normal text-muted-foreground">
            Every emulated network comes on top of it: a profile adds its delay to these, and can&apos;t get faster than
            the route&apos;s bandwidth. Round trips are measured every minute; the bandwidth after a location change or
            when the last test is over six hours old. A new session starts from the last route measured through its
            location.
          </span>
        </>
      ) : (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Spinner className="size-3" /> Measuring…
        </span>
      )}
    </section>
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
    <section className="grid gap-2">
      <SectionTitle>Paths</SectionTitle>
      <div className="overflow-hidden rounded-xl border bg-card text-xs">
        <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4rem] gap-2 border-b px-3 py-1.5 text-muted-foreground">
          <span>Path</span>
          <span className="text-right">Region</span>
          <span className="text-right">Route</span>
          <span className="text-right">Added</span>
        </div>
        {paths.map((p) => {
          const l = label(p)
          return (
            <div
              key={p.class}
              className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4rem] items-center gap-2 border-b border-border-subtle px-3 py-2 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block font-medium">{l.title}</span>
                <span className="block truncate text-muted-foreground">{l.detail}</span>
              </span>
              <span className="text-right font-mono">{p.target} ms</span>
              <span className={cn("text-right font-mono", p.baseline && p.baseline > p.target && "text-warning")}>
                {measuring ? <Spinner className="ml-auto size-3" /> : p.baseline ? `${p.baseline} ms` : "—"}
              </span>
              <span className="text-right font-mono">+{p.added} ms</span>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        The session&apos;s own route (through its VPN location) already takes some time; only the rest is added, on top
        of the access link&apos;s round trip. It is measured again every minute and after a location change.
      </p>
      {over.length > 0 && (
        <p className="flex gap-1.5 text-xs text-warning">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
          {over.map((p) => label(p).title).join(" and ")}: the session&apos;s route is already slower than in{" "}
          {info.name}, and emulation can only add delay. A VPN location closer to the servers, or none, gets nearer.
        </p>
      )}
    </section>
  )
}

function Backends({
  backends,
  addresses,
  persistent,
  busy,
  onSave,
}: {
  backends: string[]
  addresses: string[]
  persistent: boolean
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
    <section className="grid gap-1.5">
      <SectionTitle>Backends behind a CDN</SectionTitle>
      <p className="text-xs text-muted-foreground">
        Host names, or *.example.com for every name below it, whose traffic goes through to your servers even though a
        CDN fronts them, such as an API on Cloudflare. They are matched by the addresses the device gets when it looks
        them up; other hosts on the same CDN addresses take the servers&apos; path too.{" "}
        {persistent ? "Saved for this app in your account." : "Saved for this app in this browser."}
      </p>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Backends behind a CDN"
        placeholder={"api.example.com\n*.example.com"}
        rows={2}
        className="bg-card font-mono text-xs"
      />
      {addresses.length > 0 && (
        <p className="font-mono text-[11px] text-muted-foreground">
          {addresses.length === 1 ? "1 address" : `${addresses.length} addresses`}: {addresses.join(", ")}
        </p>
      )}
      {dirty && (
        <Button size="sm" className="justify-self-start" disabled={busy} onClick={() => onSave(parsed)}>
          Save backends
        </Button>
      )}
    </section>
  )
}
