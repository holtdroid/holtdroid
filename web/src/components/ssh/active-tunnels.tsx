import { Link } from "@tanstack/react-router"
import { CableIcon } from "lucide-react"
import { useSessions } from "@/api/queries"
import { useSSHTunnels } from "@/api/ssh"
import { AppIcon } from "@/components/app-icon"
import { PortChip } from "@/components/ssh/port-chip"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useNow } from "@/hooks/use-now"
import { formatRelative } from "@/lib/format"

export function ActiveTunnels() {
  const tunnels = useSSHTunnels()
  const sessions = useSessions()
  const now = useNow(30_000)
  const list = tunnels.data?.sessions ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CableIcon className="size-4" />
          Active tunnels
          {list.length > 0 && (
            <Badge variant="success" dot>
              {list.length} {list.length === 1 ? "device" : "devices"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          What your SSH connections have open right now. Click a port to copy its localhost address; the colour is from
          the last check, made while a session&apos;s SSH popover is open.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tunnels.isPending ? (
          <Skeleton className="h-12" />
        ) : list.length === 0 ? (
          <p className="text-muted-foreground text-sm">No tunnels are open right now.</p>
        ) : (
          <ul className="divide-border -my-1 divide-y divide-dashed">
            {list.map((t) => {
              const s = sessions.data?.items.find((v) => v.provider === t.provider && v.id === t.id)
              return (
                <li key={`${t.provider}/${t.id}`} className="flex items-start gap-3 py-3">
                  <AppIcon src={s?.iconUrl} className="size-9 rounded-[10px]" />
                  <div className="grid min-w-0 flex-1 gap-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <Link
                        to="/session/$provider/$id"
                        params={{ provider: t.provider, id: t.id }}
                        className="truncate font-medium hover:underline"
                      >
                        {s?.label || s?.package || "Session"}
                      </Link>
                      <code className="text-muted-foreground font-mono text-xs">
                        {t.provider}-{t.id}
                      </code>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {t.adb.map((a) => (
                        <Badge key={a.since} variant="success" dot>
                          ADB · {formatRelative(a.since, now)}
                        </Badge>
                      ))}
                      {t.reverse.map((r) => (
                        <PortChip key={r.port} tunnel={r} now={now} />
                      ))}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
