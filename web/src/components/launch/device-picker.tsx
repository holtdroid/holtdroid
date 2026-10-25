import { SearchIcon, StarIcon } from "lucide-react"
import { useMemo, useState } from "react"
import type { Display } from "@/api/client"
import { ScreenCard, screenName } from "@/components/launch/screen-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toggleFavoriteScreen, useFavoriteScreens } from "@/lib/launch-prefs"
import { cn } from "@/lib/utils"

const GENERIC = "Generic"

const brandOf = (d: Display) => d.brand || GENERIC

function matches(d: Display, q: string) {
  if (!q) return true
  const text = [d.brand, d.label, d.like, `${d.width}x${d.height}`, `${d.width}×${d.height}`, `${d.dpi}dpi`]
    .join(" ")
    .toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word))
}

export function DevicePicker({
  open,
  onOpenChange,
  screens,
  selected,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  screens: Display[]
  selected: string | undefined
  onSelect: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] sm:max-w-5xl">
        <Body
          screens={screens}
          selected={selected}
          onSelect={(id) => {
            onSelect(id)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function Body({
  screens,
  selected,
  onSelect,
}: {
  screens: Display[]
  selected: string | undefined
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const [brand, setBrand] = useState("")
  const favorites = useFavoriteScreens()
  const brands = useMemo(() => [...new Set(screens.map(brandOf))], [screens])
  const shown = screens.filter((d) => (!brand || brandOf(d) === brand) && matches(d, query.trim()))
  const starred = favorites.map((id) => shown.find((d) => d.id === id)).filter((d): d is Display => !!d)
  const rest = shown.filter((d) => !favorites.includes(d.id))
  const groups = [
    { brand: "Favorites", items: starred },
    ...brands.map((b) => ({ brand: b, items: rest.filter((d) => brandOf(d) === b) })),
  ].filter((g) => g.items.length > 0)

  return (
    <>
      <DialogHeader>
        <DialogTitle>Choose a device</DialogTitle>
        <DialogDescription>
          {screens.length} screens: generic sizes and real phones with their cutouts and rounded corners.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <div className="relative">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by brand, model or resolution…"
            className="pl-8"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {["", ...brands].map((b) => (
            <Button
              key={b || "all"}
              type="button"
              size="sm"
              variant={b === brand ? "default" : "outline"}
              className="shrink-0"
              onClick={() => setBrand(b)}
            >
              {b || "All"}
            </Button>
          ))}
        </div>
      </div>

      <div className="-mr-2 min-h-0 overflow-y-auto pr-2">
        {groups.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-sm">Nothing matches “{query}”.</p>
        ) : (
          <div className="grid gap-5 py-1">
            {groups.map((g) => (
              <section key={g.brand} className="grid gap-2">
                <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {g.brand} · {g.items.length}
                </h4>
                <div role="radiogroup" aria-label={g.brand} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {g.items.map((d) => {
                    const fav = favorites.includes(d.id)
                    return (
                      <div key={d.id} className="relative">
                        <ScreenCard display={d} selected={d.id === selected} onSelect={() => onSelect(d.id)} />
                        <button
                          type="button"
                          aria-pressed={fav}
                          aria-label={`${fav ? "Remove" : "Add"} ${screenName(d)} ${fav ? "from" : "to"} favorites`}
                          title={fav ? "Remove from favorites" : "Add to favorites"}
                          onClick={() => toggleFavoriteScreen(d.id)}
                          className="hover:bg-muted focus-visible:ring-ring/50 absolute right-1.5 bottom-1.5 grid size-7 place-items-center rounded-md outline-none focus-visible:ring-3"
                        >
                          <StarIcon
                            className={cn("size-4", fav ? "fill-amber-400 text-amber-400" : "text-muted-foreground")}
                          />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
