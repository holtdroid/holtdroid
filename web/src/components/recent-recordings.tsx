import { Link } from "@tanstack/react-router"
import { FilmIcon } from "lucide-react"
import { useRecordings } from "@/api/queries"
import { RecordingState } from "@/components/recording/recording-state"
import { recordingName } from "@/components/recording/rename-button"
import { Button } from "@/components/ui/button"
import { formatDuration } from "@/lib/format"

const SHOWN = 3

export function RecentRecordings() {
  const recordings = useRecordings()
  if (!recordings.data?.enabled) return null
  const items = recordings.data.items.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, SHOWN)
  return (
    <section className="bg-card flex min-w-0 flex-col gap-3 rounded-2xl border p-5">
      <div className="flex items-center">
        <h2 className="text-base font-semibold">Recent recordings</h2>
        <span className="flex-1" />
        <Button variant="outline" size="sm" asChild>
          <Link to="/recordings">All</Link>
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-3">
          {items.map((r) => (
            <li key={r.id} className="min-w-0">
              <Link
                to="/recordings/$id"
                params={{ id: r.id }}
                className="hover:bg-muted -m-1.5 flex min-w-0 items-center gap-3 rounded-xl p-1.5 transition-colors"
              >
                <span className="bg-stage text-muted-foreground relative grid h-[60px] w-11 shrink-0 place-items-center overflow-hidden rounded-lg border">
                  <FilmIcon className="size-4" />
                  {r.thumbnailUrl && (
                    <img
                      src={r.thumbnailUrl}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                      loading="lazy"
                    />
                  )}
                </span>
                <span className="block min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{recordingName(r)}</span>
                    <RecordingState state={r.state} />
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {[
                      [r.title && r.title !== recordingName(r) ? r.title : r.package, r.versionName]
                        .filter(Boolean)
                        .join(" "),
                      r.duration > 0 && formatDuration(r.duration),
                      r.owner,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
