import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Adb } from "@yume-chan/adb"
import { BugReport } from "@yume-chan/android-bin"
import { WritableStream } from "@yume-chan/stream-extra"
import { strToU8, zipSync } from "fflate"
import {
  CpuIcon,
  FileArchiveIcon,
  GlobeIcon,
  HardDriveIcon,
  MemoryStickIcon,
  PackageIcon,
  ServerIcon,
  SmartphoneIcon,
  ThermometerIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { agentClient, type Metrics, type SessionView, sessionBase, unwrap } from "@/api/client"
import type { AdbSession } from "@/components/session/adb-session"
import { AdbNotice, WithAdb } from "@/components/session/app-widget"
import { bytesPair, cpuLevel, MetricTile, percent } from "@/components/session/load"
import {
  CardLine,
  InfoList,
  Note,
  Row,
  Section,
  ShadeButton,
  ShadeCard,
  ShadeHeader,
  ShadePanel,
  ShadeRoot,
} from "@/components/session/shade"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { download, run, shq, stamp } from "@/lib/adb"
import { parseProps, parseWebView } from "@/lib/android"
import { formatBytes } from "@/lib/format"
import { formatLine, type LogcatStore } from "@/lib/logcat"
import { celsius, hottest, level, sensorLabel, temperatureLevel, worst } from "@/lib/thermal"

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

function settle(p: Promise<string>) {
  return p.catch((e: unknown) => `unavailable: ${errorText(e)}`)
}

export function DeviceWidget({
  session,
  adb,
  metrics,
}: {
  session: SessionView
  adb: AdbSession | null
  metrics: Metrics[]
}) {
  const m = metrics.at(-1)
  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <ShadeCard aria-label="Device">
          <WithAdb session={adb}>{(a) => <DeviceCard adb={a} slot={session.slot} />}</WithAdb>
          {!adb && (
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
              <SmartphoneIcon className="size-4 shrink-0 text-neutral-400" />
              <span className="truncate">{session.slot}</span>
            </span>
          )}
          {m && (
            <CardLine icon={CpuIcon}>
              {percent(m.device.cpu)} · {bytesPair(m.device.memoryUsed, m.device.memoryTotal).replace(" of ", "/")}
            </CardLine>
          )}
        </ShadeCard>
      </HoverCardTrigger>
      <ShadePanel>
        <ShadeHeader title="Device" summary={session.slot} />
        {m && <DeviceLoad metrics={metrics} m={m} />}
        <AdbNotice session={adb} />
        <WithAdb session={adb}>
          {(a) => <DeviceDetails adb={a} session={session} logcat={adb?.logcat ?? null} />}
        </WithAdb>
      </ShadePanel>
    </ShadeRoot>
  )
}

function useProps(adb: Adb) {
  return useQuery({
    queryKey: ["adb-device", adb.serial, "props"],
    queryFn: async () => parseProps(await run(adb, "getprop")),
    staleTime: Infinity,
  })
}

function DeviceCard({ adb, slot }: { adb: Adb; slot: string }) {
  const p = useProps(adb).data ?? {}
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        <SmartphoneIcon className="size-4 shrink-0 text-neutral-400" />
        <span className="truncate">{p["ro.product.model"] ?? slot}</span>
      </span>
      {p["ro.build.version.release"] && <CardLine icon={PackageIcon}>Android {p["ro.build.version.release"]}</CardLine>}
    </>
  )
}

function DeviceDetails({ adb, session, logcat }: { adb: Adb; session: SessionView; logcat: LogcatStore | null }) {
  const qc = useQueryClient()
  const key = ["adb-device", adb.serial]
  const p = useProps(adb).data ?? {}
  const webview = useQuery({
    queryKey: [...key, "webview"],
    queryFn: async () => parseWebView(await run(adb, "dumpsys webviewupdate")),
  })
  const switchWebView = useMutation({
    mutationFn: async (pkg: string) => {
      const out = await run(adb, `cmd webviewupdate set-webview-implementation ${shq(pkg)}`)
      if (!out.includes("Success")) throw new Error(out.trim())
    },
    onSuccess: () => toast.success("WebView provider switched", { description: "Restart the app to load it." }),
    onError: (e) => toast.error("Could not switch the WebView provider", { description: errorText(e) }),
    onSettled: () => void qc.invalidateQueries({ queryKey: [...key, "webview"] }),
  })
  const current = webview.data?.current

  return (
    <>
      <InfoList
        items={[
          ["Model", p["ro.product.model"] ?? "…"],
          [
            "Android",
            p["ro.build.version.release"] ? `${p["ro.build.version.release"]} (SDK ${p["ro.build.version.sdk"]})` : "…",
          ],
          ["Security patch", p["ro.build.version.security_patch"] ?? "…"],
          ["ABIs", p["ro.product.cpu.abilist"] ?? "…"],
          ["Build", p["ro.build.fingerprint"] ?? "…"],
        ]}
      />

      <Section title="WebView provider">
        {webview.data?.valid.map((w) => (
          <Row
            key={w.pkg}
            selected={w.pkg === current?.pkg}
            busy={switchWebView.isPending && switchWebView.variables === w.pkg}
            disabled={switchWebView.isPending || w.pkg === current?.pkg}
            icon={GlobeIcon}
            title={w.pkg}
            onClick={() => switchWebView.mutate(w.pkg)}
          >
            {w.version}
          </Row>
        ))}
      </Section>
      {(webview.data?.valid.length ?? 0) > 1 && <Note>Apps load the new provider after they restart.</Note>}

      {logcat && <BugReports adb={adb} session={session} logcat={logcat} />}
    </>
  )
}

function BugReports({ adb, session, logcat }: { adb: Adb; session: SessionView; logcat: LogcatStore }) {
  const [progress, setProgress] = useState<number | null>(null)
  const name = `${session.package}-${stamp()}`

  const bundle = useMutation({
    mutationFn: async () => {
      const agent = agentClient(session.provider, session.id)
      const [screenshot, device, props, pkg, webview] = await Promise.all([
        fetch(`${sessionBase(session.provider, session.id)}/v1/device/screenshot`)
          .then((r) => (r.ok ? r.arrayBuffer() : undefined))
          .catch(() => undefined),
        settle(unwrap(agent.GET("/v1/device")).then((d) => JSON.stringify(d, null, 2))),
        settle(run(adb, "getprop")),
        settle(run(adb, `dumpsys package ${shq(session.package)}`)),
        settle(run(adb, "dumpsys webviewupdate")),
      ])
      const files: Record<string, Uint8Array> = {
        "session.json": strToU8(JSON.stringify(session, null, 2)),
        "device.json": strToU8(device),
        "logcat.txt": strToU8(logcat.lines.map(formatLine).join("\n") + "\n"),
        "getprop.txt": strToU8(props),
        "package.txt": strToU8(pkg),
        "webview.txt": strToU8(webview),
      }
      if (screenshot) files["screenshot.png"] = new Uint8Array(screenshot)
      download(new Blob([zipSync(files, { level: 6 })], { type: "application/zip" }), `${name}.zip`)
    },
    onError: (e) => toast.error("Could not build the bug report", { description: errorText(e) }),
  })

  const full = useMutation({
    mutationFn: async () => {
      setProgress(0)
      const report = await BugReport.queryCapabilities(adb)
      const result = report.automatic((done, total) =>
        setProgress(Number(total) > 0 ? (Number(done) / Number(total)) * 100 : 0),
      )
      const parts: Uint8Array<ArrayBuffer>[] = []
      await result.stream.pipeTo(
        new WritableStream<Uint8Array>({
          write(chunk) {
            parts.push(new Uint8Array(chunk))
          },
        }),
      )
      const ext = result.type === "bugreportz" ? "zip" : "txt"
      download(new Blob(parts), `bugreport-${name}.${ext}`)
    },
    onError: (e) => toast.error("bugreport failed", { description: errorText(e) }),
    onSettled: () => setProgress(null),
  })

  return (
    <section className="grid gap-2">
      <h4 className="px-1 text-xs font-medium text-neutral-400">Bug report</h4>
      <div className="grid grid-cols-2 gap-2">
        <ShadeButton disabled={bundle.isPending} onClick={() => bundle.mutate()}>
          <PackageIcon />
          Bundle
        </ShadeButton>
        <ShadeButton disabled={full.isPending} onClick={() => full.mutate()}>
          <FileArchiveIcon />
          Full report
        </ShadeButton>
      </div>
      {progress !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
          <div className="h-full rounded-full bg-sky-300 transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}
      <Note>
        The bundle is a zip with a screenshot, the logcat kept in this tab, device and app details. The full report is
        Android&apos;s own bugreport and takes a minute or two.
      </Note>
    </section>
  )
}

function DeviceLoad({ metrics, m }: { metrics: Metrics[]; m: Metrics }) {
  const d = m.device
  const memory = d.memoryTotal > 0 ? d.memoryUsed / d.memoryTotal : 0
  const storage = d.storageTotal > 0 ? d.storageUsed / d.storageTotal : 0
  const sensors = m.thermal.filter((t) => t.source === "device")
  const node = m.thermal.filter((t) => t.source === "host")
  const headline = hottest(sensors.filter((t) => t.type === "cpu")) ?? hottest(sensors) ?? hottest(node)
  const host = m.host
  return (
    <>
      <section className="grid gap-2">
        <h4 className="px-1 text-xs font-medium text-neutral-400">Load</h4>
        <div className="grid grid-cols-2 gap-2">
          <MetricTile
            icon={CpuIcon}
            label="CPU"
            value={percent(d.cpu)}
            detail={`${d.cores} cores`}
            level={cpuLevel(d.cpu)}
            history={metrics.map((h) => h.device.cpu)}
            max={100}
            wide
          />
          <MetricTile
            icon={MemoryStickIcon}
            label="Memory"
            value={percent(memory * 100)}
            detail={bytesPair(d.memoryUsed, d.memoryTotal)}
            level={level(memory * 100, 80, 92)}
            ratio={memory}
          />
          {d.storageTotal > 0 && (
            <MetricTile
              icon={HardDriveIcon}
              label="Storage"
              value={percent(storage * 100)}
              detail={`/data, ${bytesPair(d.storageUsed, d.storageTotal)}`}
              level={level(storage * 100, 85, 95)}
              ratio={storage}
            />
          )}
        </div>
      </section>
      {headline && (
        <section className="grid gap-2">
          <h4 className="px-1 text-xs font-medium text-neutral-400">Temperature</h4>
          <MetricTile
            icon={ThermometerIcon}
            label={headline.source === "host" ? "Node" : sensorLabel(headline)}
            value={celsius(headline.celsius)}
            level={worst(...m.thermal.map(temperatureLevel))}
          />
          <InfoList
            items={[
              ...sensors.map((t): [string, string] => [sensorLabel(t), celsius(t.celsius)]),
              ...node.map((t): [string, string] => [`Node ${t.type}`, celsius(t.celsius)]),
            ]}
          />
          {host && sensors.length > 0 && (
            <Note>An emulator makes its own sensor values up; the node&apos;s are real.</Note>
          )}
        </section>
      )}
      {host && (
        <section className="grid gap-2">
          <h4 className="px-1 text-xs font-medium text-neutral-400">Emulator container</h4>
          <div className="grid grid-cols-2 gap-2">
            <MetricTile
              icon={ServerIcon}
              label="CPU"
              value={`${host.cpu.toFixed(1)} cores`}
              detail={`of ${host.cpuLimit.toFixed(0)}`}
              level={level(host.cpuLimit > 0 ? (host.cpu / host.cpuLimit) * 100 : 0, 80, 95)}
              ratio={host.cpuLimit > 0 ? host.cpu / host.cpuLimit : 0}
            />
            <MetricTile
              icon={MemoryStickIcon}
              label="Memory"
              value={formatBytes(host.memoryUsed)}
              detail={`of ${formatBytes(host.memoryLimit)}`}
              level={level(host.memoryLimit > 0 ? (host.memoryUsed / host.memoryLimit) * 100 : 0, 85, 95)}
              ratio={host.memoryLimit > 0 ? host.memoryUsed / host.memoryLimit : 0}
            />
            <MetricTile
              icon={TriangleAlertIcon}
              label="Throttled"
              value={percent(host.throttled)}
              detail="Android, the agent and the VPN together"
              level={level(host.throttled, 1, 10)}
              wide
            />
          </div>
          <Note>Throttling makes the software-rendered screen drop frames.</Note>
        </section>
      )}
    </>
  )
}
