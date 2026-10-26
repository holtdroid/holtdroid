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
import { useState } from "react"
import type { MarkerIcon, RecordingMarker } from "@/api/client"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { clock } from "@/lib/recording/timeline"
import { cn } from "@/lib/utils"

export const markerIcons: Record<MarkerIcon, { icon: LucideIcon; name: string; tone: string }> = {
  pin: { icon: PinIcon, name: "Pin", tone: "bg-stage-primary text-stage-on-primary" },
  bug: { icon: BugIcon, name: "Bug", tone: "bg-stage-error text-stage-on-error" },
  flag: { icon: FlagIcon, name: "Flag", tone: "bg-stage-blue text-stage-on-blue" },
  star: { icon: StarIcon, name: "Star", tone: "bg-stage-amber text-stage-on-amber" },
  alert: { icon: TriangleAlertIcon, name: "Warning", tone: "bg-stage-amber text-stage-on-amber" },
  check: { icon: CheckIcon, name: "Done", tone: "bg-stage-primary text-stage-on-primary" },
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

/** A pin on the timeline; for an editable recording a click opens its editor. */
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
  return (
    <Popover open={open && editable} onOpenChange={onOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          title={`${clock(marker.t)}${marker.label ? ` · ${marker.label}` : ""}`}
          aria-label={marker.label || "Marker"}
          className="absolute top-0 z-10 -translate-x-1/2 rounded-full ring-2 ring-stage-surface-low transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline-none"
          style={{ left }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onOpen(!open)}
        >
          <MarkerBadge icon={marker.icon} className="size-[22px] [&_svg]:size-3.5" />
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="center"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        className="w-72 gap-3 rounded-[24px] border-0 bg-stage-surface-container p-4 text-stage-on-surface shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
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
    <div className="grid gap-3">
      <div className="flex items-center justify-between text-xs text-stage-outline">
        <span>Marker at</span>
        <span className="font-mono text-sm text-stage-on-surface tabular-nums">{clock(marker.t, true)}</span>
      </div>
      <input
        value={label}
        autoFocus
        maxLength={120}
        placeholder="What happened here?"
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit()
            e.currentTarget.blur()
          }
          e.stopPropagation()
        }}
        className="rounded-full bg-stage-surface-low px-4 py-2 text-sm outline-none placeholder:text-stage-outline-dim focus:ring-2 focus:ring-stage-primary/60"
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Icon">
        {(Object.keys(markerIcons) as MarkerIcon[]).map((k) => (
          <button
            key={k}
            type="button"
            title={markerIcons[k].name}
            aria-pressed={marker.icon === k}
            onClick={() => onChange({ ...marker, label: label.trim(), icon: k })}
            className={cn(
              "grid size-9 place-items-center rounded-full transition-colors",
              marker.icon === k ? "bg-stage-secondary-container" : "hover:bg-stage-surface-high",
            )}
          >
            <MarkerBadge icon={k} className="size-6 [&_svg]:size-3.5" />
          </button>
        ))}
        <button
          type="button"
          title="Delete the marker"
          onClick={onRemove}
          className="ml-auto grid size-9 place-items-center rounded-full text-stage-error hover:bg-stage-error-container/40"
        >
          <Trash2Icon className="size-4" />
        </button>
      </div>
    </div>
  )
}
