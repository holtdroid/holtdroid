import { EyeIcon, EyeOffIcon, RadioIcon } from "lucide-react"
import type { FigmaLayers } from "@/api/client"
import { IconButton } from "@/components/session/icon-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** A Figma reference's components with switches to leave some out of it. */
export function ComponentsList({
  layers,
  hidden,
  onChange,
  onHover,
}: {
  layers: FigmaLayers
  hidden: string[]
  onChange: (hidden: string[]) => void
  onHover?: (id: string | null) => void
}) {
  if (!layers.composable) {
    return (
      <p className="text-muted-foreground text-xs">
        This frame&apos;s background isn&apos;t a plain colour, or a mask spans its parts, so they can&apos;t be left
        out one by one. Ignored areas still work.
      </p>
    )
  }
  const live = layers.components.filter((c) => c.live).map((c) => c.id)
  const toggle = (id: string) => onChange(hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id])
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-muted-foreground mr-auto text-xs">
          {hidden.length ? `${hidden.length} of ${layers.components.length} hidden` : "All shown"}
        </span>
        {live.some((id) => !hidden.includes(id)) && (
          <Button size="sm" variant="ghost" onClick={() => onChange([...new Set([...hidden, ...live])])}>
            <RadioIcon />
            Hide live content
          </Button>
        )}
        {hidden.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onChange([])}>
            Show all
          </Button>
        )}
      </div>
      <ul className="grid gap-0.5" onPointerLeave={() => onHover?.(null)}>
        {layers.components.toReversed().map((c) => {
          const off = hidden.includes(c.id)
          return (
            <li
              key={c.id}
              className="hover:bg-muted/60 flex items-center gap-2 rounded-md px-1 py-0.5"
              onPointerEnter={() => onHover?.(c.id)}
            >
              <div className="grid h-8 w-12 shrink-0 place-items-center overflow-hidden rounded bg-[conic-gradient(#8882_25%,transparent_0_50%,#8882_0_75%,transparent_0)] bg-[length:8px_8px] ring-1 ring-black/10">
                <img
                  src={c.url}
                  alt=""
                  loading="lazy"
                  className={cn("max-h-full max-w-full object-contain", off && "opacity-30")}
                />
              </div>
              <div className={cn("grid min-w-0 flex-1", off && "text-muted-foreground line-through")}>
                <span className="truncate text-sm" title={c.name}>
                  {c.name}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {c.type.toLowerCase()} · {Math.round(c.w)}×{Math.round(c.h)}
                </span>
              </div>
              {c.live && (
                <Badge
                  variant="outline"
                  className="shrink-0"
                  title="An image or video fill, or a name like video or map"
                >
                  live?
                </Badge>
              )}
              <IconButton label={off ? `Show ${c.name}` : `Hide ${c.name}`} onClick={() => toggle(c.id)}>
                {off ? <EyeOffIcon /> : <EyeIcon />}
              </IconButton>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
