import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Adb } from "@yume-chan/adb"
import {
  AppWindowIcon,
  DatabaseIcon,
  EraserIcon,
  ExternalLinkIcon,
  MoonStarIcon,
  OctagonXIcon,
  PackageIcon,
  PlayIcon,
  RotateCcwIcon,
  ShieldIcon,
  XIcon,
} from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import { toast } from "sonner"
import { agentClient, type SessionView, unwrap } from "@/api/client"
import { useAppData, useSaveAppData } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { type AdbSession, useAdbStatus } from "@/components/session/adb-session"
import {
  CardLine,
  Chips,
  InfoList,
  Note,
  Row,
  Section,
  ShadeButton,
  ShadeCard,
  ShadeHeader,
  ShadePanel,
  ShadeRoot,
  Tile,
} from "@/components/session/shade"
import { HoverCardTrigger } from "@/components/ui/hover-card"
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

export function AdbNotice({ session }: { session: AdbSession | null }) {
  if (!session) return <Note>The rest needs ADB in the browser, which this session doesn&apos;t offer.</Note>
  return <AdbState session={session} />
}

function AdbState({ session }: { session: AdbSession }) {
  const status = useAdbStatus(session)
  if (status.state === "ready") return null
  return (
    <div className="flex items-center gap-3 rounded-3xl bg-neutral-800 py-2 pr-2 pl-4 text-sm">
      <span className="min-w-0 flex-1 text-neutral-300">
        {status.state === "error" ? `ADB is unreachable: ${status.error}` : "Connecting to ADB for the rest…"}
      </span>
      {status.state === "error" && (
        <ShadeButton onClick={() => void session.reopen()}>
          <RotateCcwIcon />
          Retry
        </ShadeButton>
      )}
    </div>
  )
}

export function WithAdb({ session, children }: { session: AdbSession | null; children: (adb: Adb) => ReactNode }) {
  if (!session) return null
  return <ReadyAdb session={session}>{children}</ReadyAdb>
}

function ReadyAdb({ session, children }: { session: AdbSession; children: (adb: Adb) => ReactNode }) {
  const status = useAdbStatus(session)
  return status.state === "ready" ? children(status.adb) : null
}

export function AppWidget({
  provider,
  id,
  session,
  appRunning,
  adb,
}: {
  provider: string
  id: string
  session: SessionView
  appRunning: boolean
  adb: AdbSession | null
}) {
  const label = session.label || session.package
  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <ShadeCard aria-label="App">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <AppIcon src={session.iconUrl} className="size-4 shrink-0 rounded" />
            <span className="truncate">{label}</span>
          </span>
          <CardLine icon={appRunning ? PlayIcon : OctagonXIcon}>{appRunning ? "Running" : "Closed"}</CardLine>
          {session.versionName && <CardLine icon={PackageIcon}>{session.versionName}</CardLine>}
        </ShadeCard>
      </HoverCardTrigger>
      <ShadePanel>
        <ShadeHeader title={label} summary={[session.package, session.versionName].filter(Boolean).join(" · ")} />
        <AppActions provider={provider} id={id} session={session} appRunning={appRunning} adbSession={adb} />
        <AdbNotice session={adb} />
        <WithAdb session={adb}>{(a) => <AppDetails adb={a} pkg={session.package} />}</WithAdb>
      </ShadePanel>
    </ShadeRoot>
  )
}

function AppActions({
  provider,
  id,
  session,
  appRunning,
  adbSession,
}: {
  provider: string
  id: string
  session: SessionView
  appRunning: boolean
  adbSession: AdbSession | null
}) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const pkg = session.package
  const action = useMutation({
    mutationFn: (a: "restart" | "reinstall") =>
      unwrap(client.POST("/v1/app/{action}", { params: { path: { action: a } } })),
    onSuccess: (_, a) =>
      toast(a === "reinstall" ? "Reinstalling the app" : appRunning ? "Restarting the app" : "Starting the app"),
    onError: (e) => toast.error("Action failed", { description: e.message }),
  })
  const appData = useAppData()
  const save = useSaveAppData()
  const busy = action.isPending

  return (
    <Section title="Actions">
      <Row
        selected={false}
        busy={action.isPending && action.variables === "restart"}
        disabled={busy}
        icon={appRunning ? RotateCcwIcon : PlayIcon}
        title={appRunning ? "Restart app" : "Start app"}
        onClick={() => action.mutate("restart")}
      >
        {appRunning
          ? "Stops it and starts it again; DevTools and the clipboard attach to the new process"
          : "It was closed; starts it again (the device's app drawer works too)"}
      </Row>
      <Row
        selected={false}
        busy={action.isPending && action.variables === "reinstall"}
        disabled={busy}
        icon={PackageIcon}
        title="Reinstall app"
        onClick={() => action.mutate("reinstall")}
      >
        Installs this build again from scratch; its data is cleared
      </Row>
      {appData.data?.enabled && session.capabilities?.appData !== false && (
        <Row
          selected={false}
          busy={save.isPending}
          disabled={busy || save.isPending}
          icon={DatabaseIcon}
          title="Save app data"
          onClick={() =>
            save.mutate(
              { provider, id },
              {
                onSuccess: () =>
                  toast.success("App data saved", { description: "Pick it when you launch this app again." }),
                onError: (e) => toast.error("Could not save app data", { description: e.message }),
              },
            )
          }
        >
          Keeps its storage to start the next session from; the app restarts
        </Row>
      )}
      <WithAdb session={adbSession}>{(adb) => <AdbActions adb={adb} pkg={pkg} />}</WithAdb>
    </Section>
  )
}

function AdbActions({ adb, pkg }: { adb: Adb; pkg: string }) {
  const command = useMutation({
    mutationFn: ({ cmd }: { cmd: string; done: string }) => run(adb, cmd),
    onSuccess: (out, { done }) => {
      if (/Exception|Error:|Failure/.test(out)) toast.error("The device refused", { description: out.trim() })
      else toast.success(done)
    },
    onError: (e) => toast.error("Command failed", { description: errorText(e) }),
  })
  return (
    <>
      <Row
        selected={false}
        disabled={command.isPending}
        icon={OctagonXIcon}
        title="Force stop"
        onClick={() => command.mutate({ cmd: `am force-stop ${shq(pkg)}`, done: "App stopped" })}
      >
        Kills it, like Settings › Force stop
      </Row>
      <Row
        selected={false}
        disabled={command.isPending}
        icon={EraserIcon}
        title="Clear data"
        onClick={() => {
          if (window.confirm(`Clear all data of ${pkg}? The app is stopped and starts fresh.`)) {
            command.mutate({ cmd: `pm clear ${shq(pkg)}`, done: "App data cleared" })
          }
        }}
      >
        Wipes its storage and stops it; the build stays installed
      </Row>
    </>
  )
}

function AppDetails({ adb, pkg }: { adb: Adb; pkg: string }) {
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
  const command = useMutation({
    mutationFn: ({ cmd }: { cmd: string; done?: string }) => run(adb, cmd),
    onSuccess: (out, { done }) => {
      if (/Exception|Error:|Failure/.test(out)) toast.error("The device refused", { description: out.trim() })
      else if (done) toast.success(done)
    },
    onError: (e) => toast.error("Command failed", { description: errorText(e) }),
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  })
  const i = info.data

  return (
    <>
      <section className="grid gap-1.5">
        <h4 className="px-1 text-xs font-medium text-neutral-400">Details</h4>
        <InfoList
          items={[
            ["Version", i ? `${i.versionName ?? "?"}${i.versionCode ? ` (${i.versionCode})` : ""}` : "…"],
            ["Target SDK", i?.targetSdk ?? "…"],
            ["Updated", i?.lastUpdateTime ?? "…"],
          ]}
        />
      </section>

      <DeepLinks adb={adb} pkg={pkg} />

      <Section title="Permissions">
        {i?.permissions.length === 0 && (
          <p className="rounded-md bg-neutral-800 px-4 py-2.5 text-xs text-neutral-400">
            The app asks for no runtime permissions.
          </p>
        )}
        {i?.permissions.map((p) => (
          <Row
            key={p.name}
            selected={p.granted}
            disabled={command.isPending}
            icon={ShieldIcon}
            title={permissionLabel(p.name)}
            onClick={() => command.mutate({ cmd: `pm ${p.granted ? "revoke" : "grant"} ${shq(pkg)} ${shq(p.name)}` })}
          >
            {p.granted ? "Granted, click to revoke" : "Not granted, click to grant"}
          </Row>
        ))}
      </Section>

      <section className="grid gap-2">
        <h4 className="px-1 text-xs font-medium text-neutral-400">In the background</h4>
        <Tile
          icon={MoonStarIcon}
          label="Deep doze"
          status={idle.data ? "On: the device idles, jobs and alarms wait" : "Unplugs the battery and forces idle mode"}
          on={idle.data ?? false}
          wide
          disabled={command.isPending || idle.data === undefined}
          onClick={() =>
            command.mutate({
              cmd: idle.data ? "dumpsys deviceidle unforce" : "dumpsys battery unplug; dumpsys deviceidle force-idle",
              done: idle.data ? "Doze released" : "The device is dozing",
            })
          }
        />
        <Chips
          title="App standby bucket"
          options={standbyBuckets.map((b) => ({ value: b.value, label: b.label }))}
          value={bucket.data ?? ""}
          onChange={(v) => command.mutate({ cmd: `am set-standby-bucket ${shq(pkg)} ${bucketNames[v] ?? v}` })}
        />
        <Note>
          The bucket limits how often Android lets the app run jobs and alarms; rare and restricted show how it behaves
          for people who seldom open it.
        </Note>
      </section>
    </>
  )
}

function DeepLinks({ adb, pkg }: { adb: Adb; pkg: string }) {
  const [url, setUrl] = useState("")
  const [inApp, setInApp] = useState(true)
  const [history, setHistory] = useState(loadHistory)
  const [result, setResult] = useState<string | null>(null)

  const remember = (next: string[]) => {
    setHistory(next)
    try {
      localStorage.setItem(historyKey, JSON.stringify(next))
    } catch {
      return
    }
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
    <section className="grid gap-2">
      <h4 className="px-1 text-xs font-medium text-neutral-400">Deep link</h4>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (url.trim()) open.mutate(url.trim())
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="myapp://checkout?id=42 or https://…"
          aria-label="Link to open"
          className="h-10 min-w-0 flex-1 rounded-full bg-neutral-800 px-4 font-mono text-xs text-neutral-100 outline-none placeholder:text-neutral-500 focus-visible:ring-2 focus-visible:ring-sky-300"
        />
        <ShadeButton primary type="submit" disabled={open.isPending || !url.trim()}>
          <ExternalLinkIcon />
          Open
        </ShadeButton>
      </form>
      <Tile
        icon={AppWindowIcon}
        label="Only in this app"
        status={inApp ? "The link goes to this app" : "Android picks the app, as a tap would"}
        on={inApp}
        wide
        onClick={() => setInApp(!inApp)}
      />
      {history.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {history.map((h) => (
            <span key={h} className="inline-flex max-w-full items-center rounded-full bg-neutral-800 text-xs">
              <button
                type="button"
                className="truncate py-1.5 pl-3 font-mono text-neutral-200 hover:text-white"
                onClick={() => setUrl(h)}
                title={h}
              >
                {h}
              </button>
              <button
                type="button"
                aria-label={`Forget ${h}`}
                className="px-2 text-neutral-500 hover:text-neutral-200"
                onClick={() => remember(history.filter((x) => x !== h))}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {result && (
        <pre className="overflow-x-auto rounded-2xl bg-neutral-800 p-3 text-xs whitespace-pre-wrap text-neutral-300">
          {result}
        </pre>
      )}
    </section>
  )
}
