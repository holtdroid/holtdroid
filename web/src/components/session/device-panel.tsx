import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Adb } from "@yume-chan/adb"
import { BugReport, DemoMode, DemoModeSignalStrength } from "@yume-chan/android-bin"
import { WritableStream } from "@yume-chan/stream-extra"
import { zipSync, strToU8 } from "fflate"
import { FileArchiveIcon, PackageIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { agentClient, type SessionView, sessionBase, unwrap } from "@/api/client"
import { Field, Section } from "@/components/session/app-panel"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { download, run, shq, stamp } from "@/lib/adb"
import { parseProps, parseWebView } from "@/lib/android"
import { formatLine, type LogcatStore } from "@/lib/logcat"

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

function settle(p: Promise<string>) {
  return p.catch((e: unknown) => `unavailable: ${errorText(e)}`)
}

async function enterDemoMode(adb: Adb) {
  const demo = new DemoMode(adb)
  await demo.setAllowed(true)
  await demo.setEnabled(true)
  await demo.broadcast("enter")
  await demo.setTime(12, 0)
  await demo.setBatteryLevel(100)
  await demo.setBatteryCharging(false)
  await demo.setWifiSignalStrength(DemoModeSignalStrength.Level4)
  await demo.setMobileSignalStrength(DemoModeSignalStrength.Level4)
  await demo.setMobileDataType("null")
  await demo.setNotificationsVisibility(false)
}

export function DevicePanel({ adb, session, logcat }: { adb: Adb; session: SessionView; logcat: LogcatStore }) {
  const qc = useQueryClient()
  const key = ["adb-device", adb.serial]
  const props = useQuery({
    queryKey: [...key, "props"],
    queryFn: async () => parseProps(await run(adb, "getprop")),
    staleTime: Infinity,
  })
  const webview = useQuery({
    queryKey: [...key, "webview"],
    queryFn: async () => parseWebView(await run(adb, "dumpsys webviewupdate")),
  })
  const demo = useQuery({ queryKey: [...key, "demo"], queryFn: () => new DemoMode(adb).getEnabled() })

  const switchWebView = useMutation({
    mutationFn: async (pkg: string) => {
      const out = await run(adb, `cmd webviewupdate set-webview-implementation ${shq(pkg)}`)
      if (!out.includes("Success")) throw new Error(out.trim())
    },
    onSuccess: () => toast.success("WebView provider switched", { description: "Restart the app to load it." }),
    onError: (e) => toast.error("Could not switch the WebView provider", { description: errorText(e) }),
    onSettled: () => void qc.invalidateQueries({ queryKey: [...key, "webview"] }),
  })

  const toggleDemo = useMutation({
    mutationFn: (on: boolean) => (on ? enterDemoMode(adb) : new DemoMode(adb).setEnabled(false)),
    onError: (e) => toast.error("Could not change demo mode", { description: errorText(e) }),
    onSettled: () => void qc.invalidateQueries({ queryKey: [...key, "demo"] }),
  })

  const p = props.data ?? {}
  return (
    <div className="h-full overflow-y-auto">
      <Section title="Device">
        <Field label="Model">{p["ro.product.model"] ?? "…"}</Field>
        <Field label="Android">
          {p["ro.build.version.release"] ?? "…"} (SDK {p["ro.build.version.sdk"] ?? "…"})
        </Field>
        <Field label="Security patch">{p["ro.build.version.security_patch"] ?? "…"}</Field>
        <Field label="ABIs">{p["ro.product.cpu.abilist"] ?? "…"}</Field>
        <Field label="Build">
          <span title={p["ro.build.fingerprint"]}>{p["ro.build.fingerprint"] ?? "…"}</span>
        </Field>
      </Section>

      <Section title="WebView">
        <Field label="Version">{webview.data?.current?.version ?? "…"}</Field>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">Provider</span>
          <Select
            value={webview.data?.current?.pkg ?? ""}
            disabled={switchWebView.isPending || (webview.data?.valid.length ?? 0) < 2}
            onValueChange={(v) => switchWebView.mutate(v)}
          >
            <SelectTrigger size="sm" className="w-64">
              <SelectValue placeholder="…" />
            </SelectTrigger>
            <SelectContent>
              {webview.data?.valid.map((w) => (
                <SelectItem key={w.pkg} value={w.pkg}>
                  <span className="font-mono text-xs">{w.pkg}</span>
                  <span className="text-muted-foreground text-xs">{w.version}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>

      <Section title="Screenshots">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="demo-mode" className="grid gap-0.5">
            <span>Demo mode</span>
            <span className="text-muted-foreground text-xs font-normal">
              A clean status bar: 12:00, full battery and signal, no notifications
            </span>
          </Label>
          <Switch
            id="demo-mode"
            checked={demo.data ?? false}
            disabled={toggleDemo.isPending || demo.data === undefined}
            onCheckedChange={(on) => toggleDemo.mutate(on)}
          />
        </div>
      </Section>

      <BugReports adb={adb} session={session} logcat={logcat} />
    </div>
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
    <Section title="Bug report">
      <p className="text-muted-foreground text-xs">
        The bundle holds a screenshot, the logcat kept in this tab, device and app details. The full report is Android's
        own bugreport and takes a minute or two.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={bundle.isPending} onClick={() => bundle.mutate()}>
          <PackageIcon />
          Download bundle
        </Button>
        <Button size="sm" variant="outline" disabled={full.isPending} onClick={() => full.mutate()}>
          <FileArchiveIcon />
          Full Android bug report
        </Button>
      </div>
      {progress !== null && <Progress value={progress} />}
    </Section>
  )
}
