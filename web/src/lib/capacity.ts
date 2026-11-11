import type { ProviderView, SessionView } from "@/api/client"
import { sessionTone } from "@/lib/session-tone"

export type SlotTone = "running" | "starting" | "stopping" | "idle" | "failed" | "held" | "offline" | "free"

export const slotTones: { tone: SlotTone; label: string; className: string; tile: string }[] = [
  { tone: "running", label: "Running", className: "bg-success", tile: "border-transparent bg-success-soft" },
  { tone: "starting", label: "Starting", className: "bg-info", tile: "border-transparent bg-info-soft" },
  { tone: "idle", label: "Idle", className: "bg-warning", tile: "border-transparent bg-warning-soft" },
  { tone: "failed", label: "Failed", className: "bg-danger", tile: "border-transparent bg-danger-soft" },
  { tone: "stopping", label: "Stopping", className: "bg-muted-foreground", tile: "border-transparent bg-muted" },
  { tone: "held", label: "On hold", className: "bg-violet", tile: "border-transparent bg-violet-soft" },
  {
    tone: "offline",
    label: "Offline",
    className: "bg-muted-foreground/40",
    tile: "border-dashed text-muted-foreground",
  },
  { tone: "free", label: "Free", className: "bg-border", tile: "text-muted-foreground" },
]

export type Tick = { id: string; label: string; tone: SlotTone; session?: SessionView }

type Slot = ProviderView["capacity"]["slots"][number]

function toneOf(slot: Slot, session: SessionView | undefined, now: number): SlotTone {
  if (slot.state === "offline") return "offline"
  if (slot.state === "maintenance") return "held"
  if (slot.state === "free") return "free"
  if (!session) return "running"
  switch (sessionTone(session, now)) {
    case "starting":
    case "stopping":
      return "starting"
    case "idle":
      return "idle"
    case "failed":
      return "failed"
    default:
      return "running"
  }
}

export function capacityTicks(provider: ProviderView, sessions: SessionView[], now: number): Tick[] {
  return provider.capacity.slots.map((slot) => {
    const session = sessions.find((s) => s.provider === provider.name && s.slot === slot.id)
    return { id: slot.id, label: slot.label, tone: toneOf(slot, session, now), session }
  })
}

export function countTones(ticks: Tick[]) {
  const counts = new Map<SlotTone, number>()
  for (const t of ticks) counts.set(t.tone, (counts.get(t.tone) ?? 0) + 1)
  return slotTones
    .filter((t) => counts.has(t.tone))
    .map(({ tone, label, className }) => ({ tone, label, className, count: counts.get(tone) ?? 0 }))
}
