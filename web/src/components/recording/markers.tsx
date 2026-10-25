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
  pin: { icon: PinIcon, name: "Pin", tone: "bg-[#78dc9a] text-[#003919]" },
  bug: { icon: BugIcon, name: "Bug", tone: "bg-[#ffb4ab] text-[#690005]" },
  flag: { icon: FlagIcon, name: "Flag", tone: "bg-[#a8c8ff] text-[#00315c]" },
  star: { icon: StarIcon, name: "Star", tone: "bg-[#f2c162] text-[#3f2e00]" },
  alert: { icon: TriangleAlertIcon, name: "Warning", tone: "bg-[#f2c162] text-[#3f2e00]" },
  check: { icon: CheckIcon, name: "Done", tone: "bg-[#78dc9a] text-[#003919]" },
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
          className="absolute top-0 z-10 -translate-x-1/2 rounded-full ring-2 ring-[#1c211e] transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline-none"
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
        className="w-72 gap-3 rounded-[24px] border-0 bg-[#262b28] p-4 text-[#e0e3de] shadow-2xl ring-1 ring-white/10"
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
      <div className="flex items-center justify-between text-xs text-[#8a938c]">
        <span>Marker at</span>
        <span className="font-mono text-sm text-[#e0e3de] tabular-nums">{clock(marker.t, true)}</span>
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
        className="rounded-full bg-[#1c211e] px-4 py-2 text-sm outline-none placeholder:text-[#6f7872] focus:ring-2 focus:ring-[#78dc9a]/60"
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
              marker.icon === k ? "bg-[#354b3b]" : "hover:bg-[#313633]",
            )}
          >
            <MarkerBadge icon={k} className="size-6 [&_svg]:size-3.5" />
          </button>
        ))}
        <button
          type="button"
          title="Delete the marker"
          onClick={onRemove}
          className="ml-auto grid size-9 place-items-center rounded-full text-[#ffb4ab] hover:bg-[#93000a]/40"
        >
          <Trash2Icon className="size-4" />
        </button>
      </div>
    </div>
  )
}
