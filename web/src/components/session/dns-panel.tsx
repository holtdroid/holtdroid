import {
  BookmarkIcon,
  CopyIcon,
  DownloadIcon,
  EraserIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
  WandSparklesIcon,
} from "lucide-react"
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import type { DNSPreset, DNSQuery, DNSRewrite, DNSSettings } from "@/api/client"
import {
  useDeleteDNSPreset,
  useDNS,
  useDNSLog,
  useDNSPresets,
  useFlushDNS,
  useSaveDNSPreset,
  useSetDNS,
} from "@/components/session/use-dns"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  answerOf,
  blocked,
  describeRewrite,
  exportSettings,
  firstAnswer,
  importSettings,
  matches,
  mergeRewrites,
  normalizeName,
  parseAddresses,
  patternChoices,
  type RewriteAnswer,
  sameRewrites,
  ttlLabel,
  validIPv4,
  validName,
  validPattern,
} from "@/lib/dns"
import { cn } from "@/lib/utils"

const ttlChoices = ["keep", "0", "5", "30", "60", "300"]

const resultFilters = {
  all: "All queries",
  rewritten: "Rewritten",
  failed: "Failed",
  nxdomain: "NXDOMAIN",
} as const

type ResultFilter = keyof typeof resultFilters

const wallClock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour12: false,
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions)

const queryKey = (q: DNSQuery) => `${q.id}@${q.at}`

type Editing = { initial?: DNSRewrite; name?: string }
type Loaded = { id: string; name: string }

/**
 * The device's DNS as the agent answers it: every query, rewrites of names
 * to other addresses, a TTL limit and saved sets of rewrites.
 */
export function DNSPanel({ provider, id }: { provider: string; id: string }) {
  const [view, setView] = useState<"queries" | "rewrites">("queries")
  const [paused, setPaused] = useState(false)
  const [needle, setNeedle] = useState("")
  const [filter, setFilter] = useState<ResultFilter>("all")
  const [picked, setPicked] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const { queries, clear } = useDNSLog(provider, id, paused)
  const state = useDNS(provider, id)
  const set = useSetDNS(provider, id)
  const flush = useFlushDNS(provider, id)
  const settings: DNSSettings = state.data?.settings ?? { ttlMode: "keep", maxTtl: 0, rewrites: [] }
  const rewrites = settings.rewrites

  const apply = (patch: Partial<DNSSettings>, done?: () => void) =>
    set.mutate({ ...settings, ...patch }, { onSuccess: () => done?.() })
  const saveRewrite = (r: DNSRewrite, replacing?: string) => {
    const without = rewrites.filter((x) => x.pattern !== r.pattern && x.pattern !== replacing)
    const at = rewrites.findIndex((x) => x.pattern === (replacing ?? r.pattern))
    const next = at < 0 ? [...without, r] : [...without.slice(0, at), r, ...without.slice(at)]
    apply({ rewrites: next }, () => {
      setEditing(null)
      setView("rewrites")
    })
  }

  const hits = useMemo(() => {
    const m = new Map<string, number>()
    for (const q of queries) if (q.rule) m.set(q.rule, (m.get(q.rule) ?? 0) + 1)
    return m
  }, [queries])
  const names = useMemo(() => [...new Set(queries.map((q) => q.name))], [queries])

  const text = needle.trim().toLowerCase()
  const shown = queries.filter(
    (q) =>
      (!text || q.name.includes(text) || q.answers.some((a) => a.data.includes(text))) &&
      (filter === "all" ||
        (filter === "rewritten" && q.result === "rewritten") ||
        (filter === "failed" && q.result === "failed") ||
        (filter === "nxdomain" && q.rcode === "NXDOMAIN")),
  )
  const selected = queries.find((q) => queryKey(q) === picked)
  const ttlValue = settings.ttlMode === "keep" ? "keep" : String(settings.maxTtl)

  return (
    <div className="devtools-skin flex h-full flex-col bg-background text-[12px]">
      <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b px-2 [scrollbar-width:none]">
        <ViewTab active={view === "queries"} onClick={() => setView("queries")} count={queries.length}>
          Queries
        </ViewTab>
        <ViewTab active={view === "rewrites"} onClick={() => setView("rewrites")} count={rewrites.length}>
          Rewrites
        </ViewTab>
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        {view === "queries" ? (
          <>
            <ToolbarButton label={paused ? "Resume" : "Pause"} onClick={() => setPaused((v) => !v)}>
              {paused ? <PlayIcon /> : <PauseIcon />}
            </ToolbarButton>
            <ToolbarButton
              label="Clear the list"
              onClick={() => {
                clear()
                setPicked(null)
              }}
            >
              <Trash2Icon />
            </ToolbarButton>
            <input
              value={needle}
              onChange={(e) => setNeedle(e.target.value)}
              placeholder="Filter names and answers"
              className="h-6 w-48 shrink-0 rounded-sm border bg-transparent px-2 outline-none focus:border-ring"
            />
            <Select value={filter} onValueChange={(v) => setFilter(v as ResultFilter)}>
              <SelectTrigger size="sm" className="h-6 shrink-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(resultFilters).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : (
          <>
            <Button size="xs" variant="ghost" onClick={() => setEditing({})}>
              <PlusIcon />
              Add rewrite
            </Button>
            <SetsMenu
              settings={settings}
              loaded={loaded}
              onLoad={(p, how) =>
                apply(
                  how === "replace" ? p.settings : { rewrites: mergeRewrites(rewrites, p.settings.rewrites) },
                  () => {
                    setLoaded({ id: p.id, name: p.name })
                    toast.success(how === "replace" ? `Loaded “${p.name}”` : `Added “${p.name}” to the rewrites`)
                  },
                )
              }
              onSaved={(p) => setLoaded({ id: p.id, name: p.name })}
            />
            {loaded && <span className="shrink-0 truncate text-muted-foreground">from “{loaded.name}”</span>}
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Select
            value={ttlValue}
            onValueChange={(v) => apply(v === "keep" ? { ttlMode: "keep" } : { ttlMode: "limit", maxTtl: Number(v) })}
          >
            <SelectTrigger size="sm" className="h-6 text-xs" title="How long Android may cache answers">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {[...new Set([...ttlChoices, ttlValue])].map((v) => (
                <SelectItem key={v} value={v}>
                  {v === "keep" ? "TTL as answered" : v === "0" ? "TTL 0 s (no cache)" : `TTL at most ${v} s`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="xs" variant="ghost" disabled={flush.isPending} onClick={() => flush.mutate()}>
            <EraserIcon />
            Clear DNS cache
          </Button>
        </div>
      </div>

      {view === "queries" ? (
        <QueryLog
          queries={shown}
          total={queries.length}
          paused={paused}
          picked={picked}
          onPick={setPicked}
          onRewrite={(q) => {
            const r = q.rule ? rewrites.find((x) => x.pattern === q.rule) : undefined
            setEditing(r ? { initial: r } : { name: q.name })
          }}
          selected={selected}
          rewrites={rewrites}
        />
      ) : (
        <RewriteList
          rewrites={rewrites}
          hits={hits}
          busy={set.isPending}
          onToggle={(r, enabled) =>
            apply({ rewrites: rewrites.map((x) => (x.pattern === r.pattern ? { ...x, enabled } : x)) })
          }
          onEdit={(r) => setEditing({ initial: r })}
          onRemove={(r) => apply({ rewrites: rewrites.filter((x) => x.pattern !== r.pattern) })}
          onAdd={() => setEditing({})}
          onBrowse={() => setView("queries")}
        />
      )}

      {editing && (
        <RewriteDialog
          editing={editing}
          names={names}
          taken={rewrites.map((r) => r.pattern).filter((p) => p !== editing.initial?.pattern)}
          busy={set.isPending}
          onSave={(r) => saveRewrite(r, editing.initial?.pattern)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function QueryLog({
  queries,
  total,
  paused,
  picked,
  onPick,
  onRewrite,
  selected,
  rewrites,
}: {
  queries: DNSQuery[]
  total: number
  paused: boolean
  picked: string | null
  onPick: (key: string | null) => void
  onRewrite: (q: DNSQuery) => void
  selected: DNSQuery | undefined
  rewrites: DNSRewrite[]
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && follow.current) el.scrollTop = el.scrollHeight
  })

  if (total === 0) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
        {paused ? "Paused." : "No DNS query yet. Every name the device looks up shows up here, also after a reload."}
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-[92px_minmax(0,2fr)_52px_88px_minmax(0,1.4fr)_88px_56px_28px] border-b bg-muted/40 px-2 py-1 text-muted-foreground">
        <span>Time</span>
        <span>Name</span>
        <span>Type</span>
        <span>Status</span>
        <span>Answer</span>
        <span>TTL</span>
        <span className="text-right">ms</span>
        <span />
      </div>
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="min-h-0 flex-1 overflow-auto font-mono"
      >
        {queries.length === 0 && (
          <p className="p-4 text-center font-sans text-muted-foreground">Nothing matches the filter.</p>
        )}
        {queries.map((q) => {
          const key = queryKey(q)
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => onPick(picked === key ? null : key)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onPick(picked === key ? null : key)
              }}
              className={cn(
                "group grid cursor-default grid-cols-[92px_minmax(0,2fr)_52px_88px_minmax(0,1.4fr)_88px_56px_28px] items-center border-b border-border/50 px-2 py-0.5 hover:bg-accent/50",
                picked === key && "bg-accent",
                q.result === "failed" && "text-stage-error",
              )}
            >
              <span className="text-muted-foreground tabular-nums">{wallClock(q.at)}</span>
              <span className="truncate" title={q.name}>
                {q.name}
              </span>
              <span className="text-muted-foreground">{q.type}</span>
              <Status q={q} />
              <span className="truncate text-muted-foreground" title={q.answers.map((a) => a.data).join(", ")}>
                {firstAnswer(q)}
                {q.answers.length > 1 && <span className="opacity-60"> +{q.answers.length - 1}</span>}
              </span>
              <span className="truncate text-muted-foreground tabular-nums">{ttlLabel(q)}</span>
              <span className="text-right text-muted-foreground tabular-nums">
                {q.duration.toFixed(q.duration < 10 ? 1 : 0)}
              </span>
              <button
                type="button"
                title={q.rule ? `Edit the rewrite ${q.rule}` : "Rewrite this name"}
                aria-label="Rewrite this name"
                onClick={(e) => {
                  e.stopPropagation()
                  onRewrite(q)
                }}
                className="invisible grid size-5 place-items-center rounded-sm text-muted-foreground group-hover:visible hover:bg-background hover:text-foreground [&_svg]:size-3.5"
              >
                <WandSparklesIcon />
              </button>
            </div>
          )
        })}
      </div>
      {selected && <QueryDetails q={selected} rewrites={rewrites} onRewrite={() => onRewrite(selected)} />}
    </div>
  )
}

export function Status({ q }: { q: DNSQuery }) {
  const tag =
    q.result === "rewritten" ? (
      <span className="rounded-sm bg-violet-500/15 px-1 text-violet-700 dark:text-violet-300">rewrite</span>
    ) : q.result === "ipv4-only" ? (
      <span className="rounded-sm bg-muted px-1 text-muted-foreground" title="The sidecar resolves IPv4 only">
        IPv4 only
      </span>
    ) : null
  return (
    <span className="flex min-w-0 items-center gap-1 truncate">
      {tag ?? (
        <span
          className={cn(
            q.rcode === "NXDOMAIN" && "text-amber-700 dark:text-amber-400",
            q.rcode === "SERVFAIL" && "text-stage-error",
          )}
        >
          {q.rcode}
        </span>
      )}
      {tag && q.rcode !== "NOERROR" && <span className="text-amber-700 dark:text-amber-400">{q.rcode}</span>}
    </span>
  )
}

export function QueryDetails({
  q,
  rewrites,
  onRewrite,
}: {
  q: DNSQuery
  rewrites?: DNSRewrite[]
  onRewrite?: () => void
}) {
  const rule = q.rule ? rewrites?.find((r) => r.pattern === q.rule) : undefined
  return (
    <div className="max-h-[45%] shrink-0 overflow-auto border-t bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] font-medium break-all">{q.name}</span>
        <span className="text-muted-foreground">
          {q.type} over {q.protocol.toUpperCase()} · {wallClock(q.at)} · {q.duration.toFixed(1)} ms
        </span>
        <div className="ml-auto flex gap-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void navigator.clipboard.writeText(q.name).then(() => toast.success("Name copied"))}
          >
            <CopyIcon />
            Copy name
          </Button>
          {onRewrite && (
            <Button size="xs" variant="outline" onClick={onRewrite}>
              <WandSparklesIcon />
              {q.rule ? "Edit the rewrite" : "Rewrite this name…"}
            </Button>
          )}
        </div>
      </div>
      {q.rule && (
        <p className="mt-1.5 text-violet-700 dark:text-violet-300">
          Answered by the rewrite <span className="font-mono">{q.rule}</span>
          {rule ? ` → ${describeRewrite(rule)}` : rewrites ? " (since changed)" : ""}
        </p>
      )}
      {q.result === "ipv4-only" && (
        <p className="mt-1.5 text-muted-foreground">
          The sidecar resolves IPv4 only, so AAAA queries get an empty answer and apps connect over IPv4.
        </p>
      )}
      {q.error && <p className="mt-1.5 text-stage-error">{q.error}</p>}
      {q.answers.length > 0 ? (
        <table className="mt-2 w-full font-mono">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="pr-3 font-normal">Name</th>
              <th className="pr-3 font-normal">Type</th>
              <th className="pr-3 font-normal">Data</th>
              <th className="pr-3 text-right font-normal">TTL</th>
              <th className="text-right font-normal">Upstream TTL</th>
            </tr>
          </thead>
          <tbody>
            {q.answers.map((a) => (
              <tr key={`${a.name} ${a.type} ${a.data}`}>
                <td className="pr-3 break-all">{a.name}</td>
                <td className="pr-3 text-muted-foreground">{a.type}</td>
                <td className="pr-3 break-all">{a.data}</td>
                <td className="pr-3 text-right tabular-nums">{a.ttl}s</td>
                <td
                  className={cn(
                    "text-right tabular-nums",
                    a.ttl !== a.originalTtl && "text-muted-foreground line-through",
                  )}
                >
                  {a.originalTtl}s
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        !q.error && (
          <p className="mt-2 text-muted-foreground">
            {q.rcode === "NXDOMAIN" ? "The name doesn't exist." : "No records."}
          </p>
        )
      )}
    </div>
  )
}

function RewriteList({
  rewrites,
  hits,
  busy,
  onToggle,
  onEdit,
  onRemove,
  onAdd,
  onBrowse,
}: {
  rewrites: DNSRewrite[]
  hits: Map<string, number>
  busy: boolean
  onToggle: (r: DNSRewrite, enabled: boolean) => void
  onEdit: (r: DNSRewrite) => void
  onRemove: (r: DNSRewrite) => void
  onAdd: () => void
  onBrowse: () => void
}) {
  if (rewrites.length === 0) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div className="grid max-w-md justify-items-center gap-3 text-sm text-muted-foreground">
          <WandSparklesIcon className="size-6" />
          <p>
            Rewrites answer names with your own addresses: point an API at a staging server, block a tracker, or make a
            host disappear. They apply to this session only.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={onAdd}>
              <PlusIcon />
              Add rewrite
            </Button>
            <Button size="sm" variant="outline" onClick={onBrowse}>
              Pick a name from the queries
            </Button>
          </div>
          <p className="text-xs">Saved sets are under Sets; a new session always starts without rewrites.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {rewrites.map((r) => (
          <div
            key={r.pattern}
            className={cn(
              "group flex items-center gap-3 border-b border-border/50 px-3 py-1.5",
              !r.enabled && "opacity-55",
            )}
          >
            <Switch
              checked={r.enabled}
              disabled={busy}
              onCheckedChange={(v) => onToggle(r, v)}
              aria-label={r.enabled ? `Turn ${r.pattern} off` : `Turn ${r.pattern} on`}
            />
            <button
              type="button"
              onClick={() => onEdit(r)}
              className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
            >
              <span className="truncate font-mono text-[13px]">{r.pattern}</span>
              <span className="text-muted-foreground">→</span>
              <span
                className={cn("truncate font-mono", answerOf(r) !== "address" && "text-amber-700 dark:text-amber-400")}
              >
                {describeRewrite(r)}
              </span>
            </button>
            <span
              className="shrink-0 text-muted-foreground tabular-nums"
              title="How long the device may keep the answer"
            >
              TTL {r.ttl}s
            </span>
            <span
              className="w-16 shrink-0 text-right text-muted-foreground tabular-nums"
              title="Queries it answered in this list"
            >
              {hits.get(r.pattern) ?? 0} hits
            </span>
            <ToolbarButton label="Edit" onClick={() => onEdit(r)}>
              <PencilIcon />
            </ToolbarButton>
            <ToolbarButton label="Remove" onClick={() => onRemove(r)}>
              <Trash2Icon />
            </ToolbarButton>
          </div>
        ))}
      </div>
      <p className="shrink-0 border-t px-3 py-1.5 text-muted-foreground">
        Changing rewrites clears Android's DNS cache. Apps that are already connected keep the old address until they
        reconnect; a WebView keeps names for up to a minute.
      </p>
    </div>
  )
}

const answerLabels: Record<RewriteAnswer, string> = {
  address: "IP address",
  block: "Block",
  cname: "Other name",
  nxdomain: "Doesn't exist",
}

function RewriteDialog({
  editing,
  names,
  taken,
  busy,
  onSave,
  onClose,
}: {
  editing: Editing
  names: string[]
  taken: string[]
  busy: boolean
  onSave: (r: DNSRewrite) => void
  onClose: () => void
}) {
  const init = editing.initial
  const [pattern, setPattern] = useState(init?.pattern ?? editing.name ?? "")
  const [answer, setAnswer] = useState<RewriteAnswer>(init ? answerOf(init) : "address")
  const [addresses, setAddresses] = useState(
    init?.kind === "address" && answerOf(init) === "address" ? (init.addresses ?? []).join(", ") : "",
  )
  const [target, setTarget] = useState(init?.target ?? "")
  const [ttl, setTTL] = useState(String(init?.ttl ?? 0))

  const p = normalizeName(pattern)
  const ips = parseAddresses(addresses)
  const ttlN = Number(ttl)
  const problems = [
    !validPattern(p) && "Enter a name like api.example.com, or *.example.com for every name under it.",
    taken.includes(p) && `${p} already has a rewrite.`,
    answer === "address" && (ips.length === 0 || !ips.every(validIPv4)) && "Enter one or more IPv4 addresses.",
    answer === "cname" && !validName(normalizeName(target)) && "Enter the name to answer instead.",
    (!Number.isInteger(ttlN) || ttlN < 0 || ttlN > 86400) && "TTL is 0 to 86400 seconds.",
  ].filter(Boolean) as string[]
  const seen = validPattern(p) ? names.filter((n) => matches(p, n)) : []
  const choices = editing.name ? patternChoices(editing.name) : []

  const save = () => {
    if (problems.length > 0) return
    onSave({
      pattern: p,
      kind: answer === "block" ? "address" : answer,
      addresses: answer === "address" ? ips : answer === "block" ? [blocked] : undefined,
      target: answer === "cname" ? normalizeName(target) : undefined,
      ttl: ttlN,
      enabled: init?.enabled ?? true,
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{init ? "Edit rewrite" : "Rewrite a name"}</DialogTitle>
          <DialogDescription>
            The device gets this answer instead of the real one, in this session only.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="dns-pattern">Name</Label>
            <Input
              id="dns-pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="api.example.com or *.example.com"
              className="font-mono"
              autoFocus
            />
            {choices.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {choices.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPattern(c)}
                    className={cn(
                      "rounded-full border px-2 py-0.5 font-mono text-xs transition-colors hover:bg-muted",
                      p === c && "border-foreground bg-muted",
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {seen.length > 0
                ? `Matches ${seen.length === 1 ? "a name" : `${seen.length} names`} seen in this session: ${seen.slice(0, 4).join(", ")}${seen.length > 4 ? ", …" : ""}`
                : "*.example.com covers every name under example.com, not example.com itself."}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label>Answer with</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={answer}
              onValueChange={(v) => v && setAnswer(v as RewriteAnswer)}
              className="w-full"
            >
              {(Object.keys(answerLabels) as RewriteAnswer[]).map((a) => (
                <ToggleGroupItem key={a} value={a} className="flex-1">
                  {answerLabels[a]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {answer === "address" && (
              <Input
                value={addresses}
                onChange={(e) => setAddresses(e.target.value)}
                placeholder="10.0.0.12, 10.0.0.13"
                className="font-mono"
                aria-label="IPv4 addresses"
              />
            )}
            {answer === "cname" && (
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="staging.example.com"
                className="font-mono"
                aria-label="Name to answer instead"
              />
            )}
            <p className="text-xs text-muted-foreground">
              {answer === "address" && "A queries get these addresses; AAAA and other types get an empty answer."}
              {answer === "block" && "The name resolves to 0.0.0.0, so connections fail at once."}
              {answer === "cname" &&
                "The device gets a CNAME to that name and its addresses, looked up through the location."}
              {answer === "nxdomain" && "The device is told the name doesn't exist."}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="dns-ttl">TTL, seconds</Label>
            <Input
              id="dns-ttl"
              value={ttl}
              onChange={(e) => setTTL(e.target.value)}
              inputMode="numeric"
              className="w-28 font-mono"
            />
            <p className="text-xs text-muted-foreground">
              0 keeps Android from caching it, so turning the rewrite off works at once.
            </p>
          </div>

          {problems.length > 0 && p !== "" && <p className="text-sm text-destructive">{problems[0]}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={problems.length > 0 || busy}>
              {init ? "Save" : "Add rewrite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SetsMenu({
  settings,
  loaded,
  onLoad,
  onSaved,
}: {
  settings: DNSSettings
  loaded: Loaded | null
  onLoad: (p: DNSPreset, how: "replace" | "add") => void
  onSaved: (p: DNSPreset) => void
}) {
  const presets = useDNSPresets()
  const save = useSaveDNSPreset()
  const remove = useDeleteDNSPreset()
  const [naming, setNaming] = useState<{ preset?: DNSPreset; settings: DNSSettings; title: string } | null>(null)
  const [importedName, setImportedName] = useState("")
  const file = useRef<HTMLInputElement>(null)
  const items = presets.data?.items ?? []
  const current = loaded ? items.find((p) => p.id === loaded.id) : undefined
  const changed = current && !sameRewrites(current.settings.rewrites, settings.rewrites)

  const update = (p: DNSPreset) => save.mutate({ id: p.id, name: p.name, settings }, { onSuccess: onSaved })
  const download = () => {
    const blob = new Blob([exportSettings(loaded?.name ?? "DNS rewrites", settings)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${(loaded?.name ?? "dns-rewrites").replace(/[^\w.-]+/g, "-")}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const upload = async (f: File) => {
    try {
      const got = importSettings(await f.text())
      setNaming({ settings: got.settings, title: "Save the imported set" })
      setImportedName(got.name ?? f.name.replace(/\.json$/i, ""))
    } catch (e) {
      toast.error("Could not read the file", { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="xs" variant="ghost">
            <BookmarkIcon />
            Sets
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Saved sets</DropdownMenuLabel>
          {items.length === 0 && (
            <DropdownMenuItem disabled>{presets.isPending ? "Loading…" : "No saved sets yet"}</DropdownMenuItem>
          )}
          {items.map((p) => (
            <DropdownMenuSub key={p.id}>
              <DropdownMenuSubTrigger>
                <span className="truncate">{p.name}</span>
                <span className="ml-auto pl-2 text-xs text-muted-foreground tabular-nums">
                  {p.settings.rewrites.length}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-60">
                <DropdownMenuItem onSelect={() => onLoad(p, "replace")}>
                  Use instead of the current rewrites
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onLoad(p, "add")}>Add to the current rewrites</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => update(p)}>Overwrite with the current rewrites</DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setImportedName(p.name)
                    setNaming({ preset: p, settings: p.settings, title: "Rename the set" })
                  }}
                >
                  Rename…
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    remove.mutate(p.id, {
                      onSuccess: () =>
                        toast(`Deleted “${p.name}”`, {
                          action: { label: "Undo", onClick: () => save.mutate({ name: p.name, settings: p.settings }) },
                        }),
                    })
                  }
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
          <DropdownMenuSeparator />
          {current && changed && (
            <DropdownMenuItem onSelect={() => update(current)}>Save changes to “{current.name}”</DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={settings.rewrites.length === 0}
            onSelect={() => {
              setImportedName("")
              setNaming({ settings, title: "Save the rewrites as a set" })
            }}
          >
            Save as a new set…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => file.current?.click()}>
            <UploadIcon />
            Import from JSON…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={settings.rewrites.length === 0} onSelect={download}>
            <DownloadIcon />
            Export as JSON
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (f) void upload(f)
        }}
      />
      {naming && (
        <NameDialog
          title={naming.title}
          initial={importedName}
          busy={save.isPending}
          onClose={() => setNaming(null)}
          onSave={(name) =>
            save.mutate(
              { id: naming.preset?.id, name, settings: naming.settings },
              {
                onSuccess: (p) => {
                  setNaming(null)
                  if (!naming.preset) onSaved(p)
                },
              },
            )
          }
        />
      )}
    </>
  )
}

function NameDialog({
  title,
  initial,
  busy,
  onSave,
  onClose,
}: {
  title: string
  initial: string
  busy: boolean
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Saved sets are yours; load one into any session from Sets.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) onSave(name.trim())
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Staging backend"
            maxLength={80}
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ViewTab({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count: number
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-2 transition-colors",
        active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {count > 0 && <span className="rounded-full bg-muted px-1.5 text-[11px] leading-4 tabular-nums">{count}</span>}
    </button>
  )
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
    >
      {children}
    </button>
  )
}
