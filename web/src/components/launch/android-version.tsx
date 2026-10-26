import { useId, type ReactNode } from "react"
import { ChoiceCard } from "@/components/launch/choice-card"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const desserts: Record<string, ReactNode> = {
  baklava: (
    <>
      <path d="M20 5 L34 20 L20 35 L6 20Z" fill="#fff" opacity=".92" />
      <path d="M20 10 L29 20 L20 30 L11 20Z" fill="none" stroke="#0003" strokeWidth="1.5" />
      <path d="M20 15 L24.5 20 L20 25 L15.5 20Z" fill="none" stroke="#0003" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="2.2" fill="#65a30d" />
    </>
  ),
  iceCream: (
    <>
      <path d="M12 19 L20 37 L28 19Z" fill="#fde68a" />
      <path d="M14 23 L26 23 M16 28 L24 28" stroke="#b4530966" strokeWidth="1.5" />
      <circle cx="20" cy="14" r="9" fill="#fff" />
      <circle cx="25" cy="7.5" r="2.2" fill="#f43f5e" />
    </>
  ),
  upsideDownCake: (
    <>
      <rect x="5" y="6" width="30" height="3" rx="1.5" fill="#fff" />
      <rect x="9" y="9" width="22" height="16" rx="3" fill="#fff" opacity=".92" />
      <rect x="9" y="15" width="22" height="3" fill="#0002" />
      <rect x="19" y="25" width="2.5" height="7" fill="#fde68a" />
      <path d="M20.2 32 Q17.5 36 20.2 38.5 Q23 36 20.2 32Z" fill="#fbbf24" />
    </>
  ),
  tiramisu: (
    <>
      <rect x="6" y="12" width="28" height="20" rx="3" fill="#fff" />
      <rect x="6" y="18" width="28" height="3.5" fill="#78350f" opacity=".5" />
      <rect x="6" y="25.5" width="28" height="3.5" fill="#78350f" opacity=".5" />
      <path d="M9 12 H31 Q34 12 34 15 V15.5 H6 V15 Q6 12 9 12Z" fill="#78350f" opacity=".85" />
    </>
  ),
  snowCone: (
    <>
      <path d="M11 20 L29 20 L24 37 L16 37Z" fill="#fff" opacity=".85" />
      <path d="M14 25 L26 25 M15.5 31 L24.5 31" stroke="#0002" strokeWidth="1.5" />
      <path d="M9 21 Q9 6 20 6 Q31 6 31 21Z" fill="#fff" />
      <path d="M14 13 Q20 8.5 26 13" stroke="#38bdf8" strokeWidth="2" fill="none" strokeLinecap="round" />
    </>
  ),
  redVelvetCake: (
    <>
      <path d="M5 33 L35 33 L35 13Z" fill="#fff" />
      <path d="M11 29 L35 29 M19.2 23.5 L35 23.5 M27.5 18 L35 18" stroke="#be123c" strokeWidth="2.5" />
      <circle cx="33" cy="9.5" r="3" fill="#dc2626" />
    </>
  ),
}

const releases: Record<string, { name: string; from: string; to: string; dessert?: string }> = {
  "16": { name: "Baklava", from: "#34d399", to: "#0ea5e9", dessert: "baklava" },
  "15": { name: "Vanilla Ice Cream", from: "#38bdf8", to: "#6366f1", dessert: "iceCream" },
  "14": { name: "Upside Down Cake", from: "#fb923c", to: "#ef4444", dessert: "upsideDownCake" },
  "13": { name: "Tiramisu", from: "#a78bfa", to: "#ec4899", dessert: "tiramisu" },
  "12": { name: "Snow Cone", from: "#67e8f9", to: "#3b82f6", dessert: "snowCone" },
  "11": { name: "Red Velvet Cake", from: "#f87171", to: "#be123c", dessert: "redVelvetCake" },
}

const fallback = { name: "", from: "#94a3b8", to: "#475569", dessert: undefined }

export function AndroidBadge({ version, className }: { version: string; className?: string }) {
  const r = releases[version] ?? fallback
  const id = useId()
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={r.from} />
          <stop offset="1" stopColor={r.to} />
        </linearGradient>
      </defs>
      <path d="M18 10 H82 Q96 10 89 23 L58 84 Q50 98 42 84 L11 23 Q4 10 18 10Z" fill={`url(#${id})`} />
      <path d="M25 21 H75 Q85 21 80 31 L56 77 Q50 88 44 77 L20 31 Q15 21 25 21Z" fill="#1c1b22" />
      <g fill="#fff">
        <circle cx="27" cy="27" r=".9" />
        <circle cx="73" cy="26" r="1.1" />
        <circle cx="70" cy="44" r=".8" />
        <circle cx="29" cy="40" r=".7" />
        <circle cx="76" cy="34" r=".6" />
      </g>
      {r.dessert && <g transform="translate(34 20) scale(.8)">{desserts[r.dessert]}</g>}
      <circle cx="50" cy="70.5" r="11.5" fill="#5f5e66" stroke={`url(#${id})`} strokeWidth="2" />
      <text
        x="50"
        y="75"
        textAnchor="middle"
        fontSize={version.length > 2 ? 10 : 13}
        fontWeight="600"
        fill="#fff"
        fontFamily="system-ui, sans-serif"
      >
        {version}
      </text>
    </svg>
  )
}

export function AndroidVersionCard({
  version,
  selected,
  blockedBy,
  alternative,
  onSelect,
}: {
  version: string
  selected: boolean
  blockedBy?: string
  alternative?: string
  onSelect: () => void
}) {
  const r = releases[version] ?? fallback
  const card = (
    <ChoiceCard
      selected={selected}
      onSelect={onSelect}
      disabled={!!blockedBy && !alternative}
      className={cn("items-center gap-2 p-2.5 text-center", blockedBy && alternative && "opacity-70")}
    >
      <div
        className="grid h-20 w-full place-items-center rounded-lg"
        style={{ backgroundImage: `linear-gradient(135deg, ${r.from}26, ${r.to}26)` }}
      >
        <AndroidBadge version={version} className="size-[4.5rem]" />
      </div>
      <div className="w-full min-w-0 px-0.5">
        <div className="text-sm font-medium">Android {version}</div>
        {blockedBy && alternative ? (
          <div className="text-muted-foreground truncate text-xs">Use {alternative}</div>
        ) : (
          r.name && <div className="text-muted-foreground truncate text-xs">{r.name}</div>
        )}
      </div>
    </ChoiceCard>
  )
  if (!blockedBy) return card
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="grid min-w-0">
          {card}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {blockedBy}
        {alternative && `. Switches to ${alternative}, the newest build that runs on it.`}
      </TooltipContent>
    </Tooltip>
  )
}
