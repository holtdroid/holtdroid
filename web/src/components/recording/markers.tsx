import {
  BugIcon,
  CheckIcon,
  FlagIcon,
  type LucideIcon,
  PinIcon,
  StarIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { useRef, useState } from "react"
import type { MarkerIcon, RecordingMarker } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { clock } from "@/lib/recording/timeline"
import { cn } from "@/lib/utils"

export const markerIcons: Record<MarkerIcon, { icon: LucideIcon; name: string; tone: string; soft: string }> = {
  pin: {
    icon: PinIcon,
    name: "Pin",
    tone: "bg-primary text-primary-foreground",
    soft: "bg-accent text-muted-foreground",
  },
  bug: { icon: BugIcon, name: "Bug", tone: "bg-danger text-danger-foreground", soft: "bg-danger-soft text-danger" },
  flag: { icon: FlagIcon, name: "Flag", tone: "bg-info text-info-foreground", soft: "bg-info-soft text-info" },
  star: {
    icon: StarIcon,
    name: "Star",
    tone: "bg-warning text-warning-foreground",
    soft: "bg-warning-soft text-warning",
  },
  alert: {
    icon: TriangleAlertIcon,
    name: "Warning",
    tone: "bg-warning text-warning-foreground",
    soft: "bg-warning-soft text-warning",
  },
  check: {
    icon: CheckIcon,
    name: "Done",
    tone: "bg-primary text-primary-foreground",
    soft: "bg-success-soft text-success",
  },
}

export function newMarkerId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8)
}

export function MarkerBadge({ icon, className }: { icon: MarkerIcon; className?: string }) {
  const m = markerIcons[icon] ?? markerIcons.pin
  return (
    <span className={cn("grid size-5 place-items-center rounded-full [&_svg]:size-3", m.tone, className)}>
      <m.icon />
    </span>
  )
}

/** A labelled pin on the Markers lane; for an editable recording a click opens its editor. */
export function MarkerPin({
  marker,
  left,
  open,
  editable,
  onOpen,
  onChange,
  onRemove,
}: {
  marker: RecordingMarker
  left: string
  open: boolean
  editable: boolean
  onOpen: (open: boolean) => void
  onChange: (next: RecordingMarker) => void
  onRemove: () => void
}) {
  const m = markerIcons[marker.icon] ?? markerIcons.pin
  return (
    <Popover open={open && editable} onOpenChange={onOpen}>
      <span
        className="absolute bottom-0 flex -translate-x-px flex-col items-start hover:z-10 focus-within:z-10"
        style={{ left }}
      >
        <PopoverAnchor asChild>
          <button
            type="button"
            title={`${clock(marker.t)}${marker.label ? ` · ${marker.label}` : ""}`}
            aria-label={marker.label || `Marker at ${clock(marker.t)}`}
            className={cn(
              "inline-flex h-[22px] max-w-40 items-center gap-1 rounded-[6px_6px_6px_0] px-[7px] text-[11.5px] font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
              m.soft,
              open && "ring-1 ring-current",
            )}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onOpen(!open)}
          >
            <m.icon className="size-3 shrink-0" />
            <span className="truncate">{marker.label || clock(marker.t)}</span>
          </button>
        </PopoverAnchor>
        <span aria-hidden className={cn("h-[22px] w-0.5", m.soft, "bg-current")} />
      </span>
      <PopoverContent
        side="top"
        align="start"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        className="w-[300px] gap-0 rounded-xl p-3"
      >
        <MarkerEditor marker={marker} onChange={onChange} onRemove={onRemove} />
      </PopoverContent>
    </Popover>
  )
}

function MarkerEditor({
  marker,
  onChange,
  onRemove,
}: {
  marker: RecordingMarker
  onChange: (next: RecordingMarker) => void
  onRemove: () => void
}) {
  const [label, setLabel] = useState(marker.label ?? "")
  const commit = () => {
    if (label.trim() !== (marker.label ?? "")) onChange({ ...marker, label: label.trim() })
  }
  return (
    <div className="grid gap-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Marker at</span>
        <span className="font-mono text-[13px]">{clock(marker.t, true)}</span>
        <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Delete the marker" onClick={onRemove}>
          <Trash2Icon />
        </Button>
      </div>
      <div className="flex gap-0.5 rounded-[9px] border bg-muted p-[3px]" role="group" aria-label="Kind">
        {(Object.keys(markerIcons) as MarkerIcon[]).map((k) => {
          const Icon = markerIcons[k].icon
          return (
            <button
              key={k}
              type="button"
              title={markerIcons[k].name}
              aria-label={markerIcons[k].name}
              aria-pressed={marker.icon === k}
              onClick={() => onChange({ ...marker, label: label.trim(), icon: k })}
              className={cn(
                "grid h-[26px] flex-1 place-items-center rounded-[7px] border border-transparent text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5",
                marker.icon === k && "border-border bg-card text-foreground",
              )}
            >
              <Icon />
            </button>
          )
        })}
      </div>
      <label className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">What happened here?</span>
        <Input
          value={label}
          autoFocus
          maxLength={120}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit()
              e.currentTarget.blur()
            }
            e.stopPropagation()
          }}
        />
      </label>
    </div>
  )
}

/** The small field that opens on the stage when M pins a marker: Enter names it, Esc leaves it unnamed. */
export function QuickMarker({ marker, onDone }: { marker: RecordingMarker; onDone: (label: string | null) => void }) {
  const [label, setLabel] = useState("")
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <div className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2 shadow-float">
      <FlagIcon className="size-4 shrink-0 text-warning" />
      <span className="font-mono text-xs text-muted-foreground">{clock(marker.t)}</span>
      <input
        autoFocus
        value={label}
        maxLength={120}
        aria-label="Marker text"
        placeholder="What happened?"
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => finish(label.trim() || null)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Enter") finish(label.trim() || null)
          else if (e.key === "Escape") finish(null)
        }}
        className="h-7 w-40 rounded-[7px] border border-foreground bg-muted px-2 text-[13px] outline-none placeholder:text-muted-foreground"
      />
      <span className="rounded-sm border px-1.5 text-[11px] text-muted-foreground">Enter</span>
    </div>
  )
}
