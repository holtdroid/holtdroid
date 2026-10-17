import { useNavigate, useSearch } from "@tanstack/react-router"
import { DownloadIcon, InfoIcon, ListFilterIcon, SearchIcon, ShieldAlertIcon, UserIcon, XIcon } from "lucide-react"
import { useRef, useState } from "react"
import {
  type AuditFilter,
  type AuditInfo,
  type AuditRange,
  type AuditResult,
  auditExportURL,
  auditRanges,
  useAuditEvents,
  useAuditInfo,
} from "@/api/audit"
import { useMe } from "@/api/queries"
import { AuditTable } from "@/components/audit/audit-table"
import { Combobox } from "@/components/combobox"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useNow } from "@/hooks/use-now"
import { formatSpan } from "@/lib/format"

const ALL = "all"
const results: AuditResult[] = ["ok", "denied", "failed"]

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined)

export function validateAuditSearch(search: Record<string, unknown>): AuditFilter {
  const result = str(search.result)
  const range = str(search.range)
  return {
    action: str(search.action),
    result: results.includes(result as AuditResult) ? (result as AuditResult) : undefined,
    actor: str(search.actor),
    service: str(search.service),
    session: str(search.session),
    q: str(search.q),
    range: range && range in auditRanges ? (range as AuditRange) : undefined,
  }
}

function actionOptions(actions: string[]) {
  const categories = [...new Set(actions.map((a) => a.split(".")[0] ?? a))]
  return [
    ...categories.map((c) => ({ value: c, label: `${c}.*`, hint: "every action in this group" })),
    ...actions.map((a) => ({ value: a, label: a })),
  ]
}

function retention(info: AuditInfo) {
  const parts = [`Keeping ${info.events.toLocaleString()} of up to ${info.maxEvents.toLocaleString()} events`]
  if (info.maxAge > 0) parts.push(`for at most ${formatSpan(info.maxAge)}`)
  parts.push(info.persistent ? "in a file that survives restarts" : "in memory only, until the api restarts")
  return `${parts.join(", ")}.`
}

export function AuditPage() {
  const me = useMe()
  const admin = me.data?.admin === true
  const filter = useSearch({ from: "/audit" })
  const navigate = useNavigate({ from: "/audit" })
  const [live, setLive] = useState(true)
  const info = useAuditInfo(admin)
  const enabled = admin && info.data?.enabled === true
  const events = useAuditEvents(filter, { enabled, live })
  const now = useNow(30_000)

  const [text, setText] = useState(filter.q ?? "")
  const [syncedQ, setSyncedQ] = useState(filter.q)
  if (syncedQ !== filter.q) {
    setSyncedQ(filter.q)
    setText(filter.q ?? "")
  }
  const typing = useRef<number | undefined>(undefined)

  const update = (patch: AuditFilter) =>
    void navigate({ search: (prev: AuditFilter) => ({ ...prev, ...patch }), replace: true })
  const search = (q: string) => {
    setText(q)
    window.clearTimeout(typing.current)
    typing.current = window.setTimeout(() => {
      setSyncedQ(q || undefined)
      update({ q: q || undefined })
    }, 300)
  }
  const filtered = Object.values(filter).some((v) => v !== undefined)
  const items = events.data?.pages.flatMap((p) => p.items) ?? []

  if (me.data && !admin) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Alert>
          <ShieldAlertIcon />
          <AlertTitle>Admins only</AlertTitle>
          <AlertDescription>The audit log is visible to members of the admin groups.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
            <p className="text-muted-foreground max-w-2xl text-sm">
              Who did what, from the portal and the SSH gateway. {info.data?.enabled ? retention(info.data) : null}
            </p>
          </div>
          {enabled && (
            <div className="flex items-center gap-3">
              <Label className="font-normal">
                <Switch checked={live} onCheckedChange={setLive} />
                Live
                {live && events.isFetching && <Spinner className="size-3" />}
              </Label>
              <Button variant="outline" size="sm" asChild>
                <a href={auditExportURL(filter)} download>
                  <DownloadIcon /> Export JSONL
                </a>
              </Button>
            </div>
          )}
        </div>

        {info.data && !info.data.enabled && (
          <Alert>
            <InfoIcon />
            <AlertTitle>The audit store is turned off</AlertTitle>
            <AlertDescription>
              Events still go to stdout and the configured sinks. Set audit.store.enabled to browse recent events here;
              audit.store.maxEvents, maxAge and path control how many are kept and where.
            </AlertDescription>
          </Alert>
        )}

        {(info.isError || events.isError) && (
          <Alert variant="destructive">
            <AlertDescription>{(info.error ?? events.error)?.message}</AlertDescription>
          </Alert>
        )}

        {enabled && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <InputGroup className="h-7 w-full sm:w-72">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  value={text}
                  onChange={(e) => search(e.target.value)}
                  placeholder="Search any field"
                  aria-label="Search"
                />
                {text && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton size="icon-xs" onClick={() => search("")} aria-label="Clear search">
                      <XIcon />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
              <Combobox
                options={[{ value: ALL, label: "All actions" }, ...actionOptions(info.data?.actions ?? [])]}
                value={filter.action ?? ALL}
                onChange={(v) => update({ action: v === ALL ? undefined : v })}
                placeholder="Action"
                icon={ListFilterIcon}
                className="w-44"
              />
              <Combobox
                options={[
                  { value: ALL, label: "Everyone" },
                  ...(info.data?.actors ?? []).map((a) => ({ value: a, label: a })),
                ]}
                value={filter.actor ?? ALL}
                onChange={(v) => update({ actor: v === ALL ? undefined : v })}
                placeholder="User"
                icon={UserIcon}
                className="w-40"
              />
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                value={filter.result ?? ALL}
                onValueChange={(v) => v && update({ result: v === ALL ? undefined : (v as AuditResult) })}
              >
                <ToggleGroupItem value={ALL}>All</ToggleGroupItem>
                {results.map((r) => (
                  <ToggleGroupItem key={r} value={r}>
                    {r}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Select
                value={filter.service ?? ALL}
                onValueChange={(v) => update({ service: v === ALL ? undefined : v })}
              >
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All services</SelectItem>
                  <SelectItem value="api">Portal</SelectItem>
                  <SelectItem value="ssh-gateway">SSH gateway</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filter.range ?? ALL}
                onValueChange={(v) => update({ range: v === ALL ? undefined : (v as AuditRange) })}
              >
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any time</SelectItem>
                  {Object.entries(auditRanges).map(([k, r]) => (
                    <SelectItem key={k} value={k}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filter.session && (
                <Button variant="secondary" size="sm" onClick={() => update({ session: undefined })}>
                  Session {filter.session} <XIcon />
                </Button>
              )}
              {filtered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setText("")
                    void navigate({ search: {}, replace: true })
                  }}
                >
                  Reset
                </Button>
              )}
            </div>

            <div className="rounded-lg border">
              {events.isPending ? (
                <div className="grid gap-2 p-3">
                  {Array.from({ length: 8 }, (_, i) => (
                    <Skeleton key={i} className="h-6" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <p className="text-muted-foreground p-6 text-center text-sm">
                  {filtered ? "No events match these filters." : "No events yet."}
                </p>
              ) : (
                <AuditTable events={items} now={now} onFilter={update} />
              )}
            </div>

            {events.hasNextPage && (
              <Button
                variant="outline"
                className="justify-self-center"
                disabled={events.isFetchingNextPage}
                onClick={() => void events.fetchNextPage()}
              >
                {events.isFetchingNextPage && <Spinner />}
                Load older events
              </Button>
            )}
          </>
        )}

        {admin && info.isPending && <Skeleton className="h-64" />}
      </div>
    </div>
  )
}
