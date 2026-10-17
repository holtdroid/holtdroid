import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Adb } from "@yume-chan/adb"
import { ExternalLinkIcon, EraserIcon, OctagonXIcon, XIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { run, shq } from "@/lib/adb"
import { bucketNames, parsePackage, permissionLabel, standbyBuckets } from "@/lib/android"

const historyKey = "holtdroid.deepLinks"

function loadHistory(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(historyKey) ?? "[]")
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="grid gap-2 border-b p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-xs">{children}</span>
    </div>
  )
}

export function AppPanel({ adb, pkg }: { adb: Adb; pkg: string }) {
  const qc = useQueryClient()
  const key = ["adb-app", adb.serial, pkg]
  const info = useQuery({
    queryKey: [...key, "package"],
    queryFn: async () => parsePackage(await run(adb, `dumpsys package ${shq(pkg)}`)),
  })
  const bucket = useQuery({
    queryKey: [...key, "bucket"],
    queryFn: async () => (await run(adb, `am get-standby-bucket ${shq(pkg)}`)).trim(),
  })
  const idle = useQuery({
    queryKey: [...key, "idle"],
    queryFn: async () => (await run(adb, "dumpsys deviceidle get deep")).trim() === "IDLE",
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: key })

  const command = useMutation({
    mutationFn: ({ cmd }: { cmd: string; done?: string }) => run(adb, cmd),
    onSuccess: (out, { done }) => {
      if (/Exception|Error:|Failure/.test(out)) toast.error("The device refused", { description: out.trim() })
      else if (done) toast.success(done)
    },
    onError: (e) => toast.error("Command failed", { description: errorText(e) }),
    onSettled: refresh,
  })

  return (
    <div className="h-full overflow-y-auto">
      <Section title="App">
        <Field label="Package">{pkg}</Field>
        <Field label="Version">
          {info.data?.versionName ?? "…"}
          {info.data?.versionCode ? ` (${info.data.versionCode})` : ""}
        </Field>
        <Field label="Target SDK">{info.data?.targetSdk ?? "…"}</Field>
        <Field label="Updated">{info.data?.lastUpdateTime ?? "…"}</Field>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={command.isPending}
            onClick={() => command.mutate({ cmd: `am force-stop ${shq(pkg)}`, done: "App stopped" })}
          >
            <OctagonXIcon />
            Force stop
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={command.isPending}
            onClick={() => {
              if (window.confirm(`Clear all data of ${pkg}? The app is stopped and starts fresh.`)) {
                command.mutate({ cmd: `pm clear ${shq(pkg)}`, done: "App data cleared" })
              }
            }}
          >
            <EraserIcon />
            Clear data
          </Button>
        </div>
      </Section>

      <DeepLinks adb={adb} pkg={pkg} />

      <Section title="Permissions">
        {info.data?.permissions.length === 0 && (
          <p className="text-muted-foreground text-sm">The app asks for no runtime permissions.</p>
        )}
        {info.data?.permissions.map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-2">
            <Label htmlFor={`perm-${p.name}`} className="min-w-0 truncate font-mono text-xs" title={p.name}>
              {permissionLabel(p.name)}
            </Label>
            <Switch
              id={`perm-${p.name}`}
              checked={p.granted}
              disabled={command.isPending}
              onCheckedChange={(on) =>
                command.mutate({ cmd: `pm ${on ? "grant" : "revoke"} ${shq(pkg)} ${shq(p.name)}` })
              }
            />
          </div>
        ))}
      </Section>

      <Section title="Background">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="doze" className="grid gap-0.5">
            <span>Deep doze</span>
            <span className="text-muted-foreground text-xs font-normal">Unplugs the battery and forces idle mode</span>
          </Label>
          <Switch
            id="doze"
            checked={idle.data ?? false}
            disabled={command.isPending || idle.data === undefined}
            onCheckedChange={(on) =>
              command.mutate({
                cmd: on ? "dumpsys battery unplug; dumpsys deviceidle force-idle" : "dumpsys deviceidle unforce",
                done: on ? "The device is dozing" : "Doze released",
              })
            }
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">App standby bucket</span>
          <Select
            value={bucket.data ?? ""}
            disabled={command.isPending}
            onValueChange={(v) => command.mutate({ cmd: `am set-standby-bucket ${shq(pkg)} ${bucketNames[v] ?? v}` })}
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue placeholder="…" />
            </SelectTrigger>
            <SelectContent>
              {standbyBuckets.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>
    </div>
  )
}

function DeepLinks({ adb, pkg }: { adb: Adb; pkg: string }) {
  const [url, setUrl] = useState("")
  const [inApp, setInApp] = useState(true)
  const [history, setHistory] = useState(loadHistory)
  const [result, setResult] = useState<string | null>(null)

  const remember = (next: string[]) => {
    setHistory(next)
    localStorage.setItem(historyKey, JSON.stringify(next))
  }

  const open = useMutation({
    mutationFn: (link: string) =>
      run(adb, `am start -W -a android.intent.action.VIEW -d ${shq(link)}${inApp ? ` ${shq(pkg)}` : ""}`),
    onSuccess: (out, link) => {
      setResult(out.trim())
      remember([link, ...history.filter((h) => h !== link)].slice(0, 8))
    },
    onError: (e) => setResult(errorText(e)),
  })

  return (
    <Section title="Deep link">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (url.trim()) open.mutate(url.trim())
        }}
      >
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="myapp://checkout?id=42 or https://…"
          className="h-8 font-mono text-xs"
        />
        <Button size="sm" type="submit" disabled={open.isPending || !url.trim()}>
          <ExternalLinkIcon />
          Open
        </Button>
      </form>
      <div className="flex items-center gap-2">
        <Checkbox id="deeplink-app" checked={inApp} onCheckedChange={(v) => setInApp(v === true)} />
        <Label htmlFor="deeplink-app" className="text-xs font-normal">
          Only in this app
        </Label>
      </div>
      {history.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {history.map((h) => (
            <span key={h} className="bg-muted inline-flex max-w-full items-center rounded-md text-xs">
              <button type="button" className="truncate px-2 py-0.5 font-mono" onClick={() => setUrl(h)} title={h}>
                {h}
              </button>
              <button
                type="button"
                aria-label={`Forget ${h}`}
                className="text-muted-foreground hover:text-foreground pr-1.5"
                onClick={() => remember(history.filter((x) => x !== h))}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {result && <pre className="bg-muted overflow-x-auto rounded-md p-2 text-xs whitespace-pre-wrap">{result}</pre>}
    </Section>
  )
}
