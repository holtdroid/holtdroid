import { Link } from "@tanstack/react-router"
import { LaptopIcon, PlusIcon, SmartphoneIcon } from "lucide-react"
import { useState } from "react"
import { useSessions } from "@/api/queries"
import { useSetPublished } from "@/api/ssh"
import type { Computer } from "@/api/client"
import { CopyButton } from "@/components/copy-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useNow } from "@/hooks/use-now"
import { groupPorts } from "@/lib/dev-ports"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

const osName: Record<string, string> = { darwin: "macOS", linux: "Linux", windows: "Windows" }

export function parsePort(text: string): number | null {
  const n = Number(text.trim())
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
}

export function ComputerCard({ computer: c }: { computer: Computer }) {
  const now = useNow(30_000)
  const sessions = useSessions()
  const setPublished = useSetPublished()
  const [draft, setDraft] = useState("")
  const published = new Set(c.published)
  const processes = new Map(c.listening.map((p) => [p.port, p.process]))
  const groups = groupPorts(c.listening, c.published)
  const [showAll, setShowAll] = useState(false)
  const ports = showAll ? [...groups.main, ...groups.other].toSorted((a, b) => a - b) : groups.main
  const draftPort = parsePort(draft)

  const publish = (next: Set<number>) => setPublished.mutate({ id: c.id, ports: [...next].toSorted((a, b) => a - b) })
  const toggle = (port: number) => {
    const next = new Set(published)
    if (next.has(port)) next.delete(port)
    else next.add(port)
    publish(next)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LaptopIcon className="size-4" />
          {c.hostname}
          <span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            connected {formatRelative(c.since, now)}
          </span>
        </CardTitle>
        <CardDescription>
          {[osName[c.os] ?? c.os, c.arch].filter(Boolean).join(" ")} · {c.clientIP}
          {c.version && ` · client ${c.version}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <span className="text-xs font-medium">Ports published on your devices</span>
          <div className="flex flex-wrap gap-1.5">
            {ports.length === 0 && (
              <span className="text-muted-foreground text-xs">
                {groups.other.length === 0
                  ? "Nothing listens on this computer's loopback."
                  : "No dev server is listening on this computer."}
              </span>
            )}
            {ports.map((port) => {
              const on = published.has(port)
              const process = processes.get(port)
              return (
                <Badge
                  key={port}
                  asChild
                  variant="outline"
                  className={cn(
                    "cursor-pointer gap-1.5 font-mono",
                    on && "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={on}
                    title={on ? "Published — click to stop" : "Click to publish on your devices"}
                    onClick={() => toggle(port)}
                  >
                    <span className={cn("size-1.5 rounded-full", on ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                    {port}
                    {process && <span className="font-sans opacity-70">{process}</span>}
                    {!processes.has(port) && <span className="font-sans opacity-70">not listening</span>}
                  </button>
                </Badge>
              )
            })}
            {groups.other.length > 0 && (
              <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show fewer" : `Show all ${groups.main.length + groups.other.length}`}
              </Button>
            )}
          </div>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (draftPort === null) return
              publish(new Set([...published, draftPort]))
              setDraft("")
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Another port, e.g. 5173"
              aria-invalid={draft !== "" && draftPort === null}
              className="h-8 max-w-48 font-mono text-xs"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={draftPort === null}>
              <PlusIcon />
              Publish
            </Button>
          </form>
          <p className="text-muted-foreground text-xs">
            Apps on your devices reach a published port as http://localhost:&lt;port&gt;.
          </p>
        </div>

        <div className="grid gap-2">
          <span className="text-xs font-medium">ADB</span>
          {c.adb.length === 0 ? (
            <span className="text-muted-foreground text-xs">No device is running.</span>
          ) : (
            <ul className="grid gap-1.5">
              {c.adb.map((a) => {
                const s = sessions.data?.items.find((v) => `${v.provider}-${v.id}` === a.session)
                const address = `127.0.0.1:${a.port}`
                return (
                  <li key={a.session} className="flex items-center gap-2 text-sm">
                    <SmartphoneIcon className="text-muted-foreground size-3.5" />
                    {s ? (
                      <Link
                        to="/session/$provider/$id"
                        params={{ provider: s.provider, id: s.id }}
                        className="truncate hover:underline"
                      >
                        {s.label || s.package}
                      </Link>
                    ) : (
                      <code className="font-mono text-xs">{a.session}</code>
                    )}
                    <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">adb -s {address}</code>
                    <CopyButton text={address} label="Copy the address" />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
