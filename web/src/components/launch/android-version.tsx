import { ChoiceCard } from "@/components/launch/choice-card"

const releases: Record<string, { name: string; from: string; to: string }> = {
  "16": { name: "Baklava", from: "#34d399", to: "#0ea5e9" },
  "15": { name: "Vanilla Ice Cream", from: "#38bdf8", to: "#6366f1" },
  "14": { name: "Upside Down Cake", from: "#fb923c", to: "#ef4444" },
  "13": { name: "Tiramisu", from: "#a78bfa", to: "#ec4899" },
  "12": { name: "Snow Cone", from: "#67e8f9", to: "#3b82f6" },
  "11": { name: "Red Velvet Cake", from: "#f87171", to: "#be123c" },
}

const fallback = { name: "", from: "#94a3b8", to: "#475569" }

function AndroidMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M5.5 17a6.5 6.5 0 0 1 13 0z" fill="currentColor" />
      <path d="M8 6.2 6.6 4M16 6.2 17.4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="9.4" cy="14" r="0.95" fill="#0000008c" />
      <circle cx="14.6" cy="14" r="0.95" fill="#0000008c" />
    </svg>
  )
}

export function AndroidVersionCard({
  version,
  selected,
  onSelect,
}: {
  version: string
  selected: boolean
  onSelect: () => void
}) {
  const r = releases[version] ?? fallback
  return (
    <ChoiceCard selected={selected} onSelect={onSelect} className="gap-2.5 p-2.5">
      <div
        className="relative flex h-16 items-center justify-between overflow-hidden rounded-lg px-3 text-white"
        style={{ backgroundImage: `linear-gradient(135deg, ${r.from}, ${r.to})` }}
      >
        <AndroidMark className="size-9 opacity-90" />
        <span className="text-3xl leading-none font-semibold tracking-tight">{version}</span>
        <span className="pointer-events-none absolute -right-4 -bottom-6 size-16 rounded-full bg-white/15" />
      </div>
      <div className="px-0.5">
        <div className="text-sm font-medium">Android {version}</div>
        {r.name && <div className="text-muted-foreground truncate text-xs">{r.name}</div>}
      </div>
    </ChoiceCard>
  )
}
