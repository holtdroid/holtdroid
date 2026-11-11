import { ArrowLeftIcon, SearchIcon, StarIcon, XIcon } from "lucide-react"
import { useMemo, useState } from "react"
import type { Display } from "@/api/client"
import { Chip, Count, optionClass } from "@/components/launch/choice-card"
import { PhonePreview } from "@/components/launch/phone-preview"
import { Button } from "@/components/ui/button"
import { DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { toggleFavoriteScreen, useFavoriteScreens } from "@/lib/launch-prefs"
import { cutoutName, type ScreenFilter, screenFacts, screenFilters, screenMatches, screenName } from "@/lib/screens"
import { cn } from "@/lib/utils"

const GENERIC = "Generic"

const brandOf = (d: Display) => d.brand || GENERIC

export function DevicePicker({
  screens,
  selected,
  onSelect,
  onBack,
}: {
  screens: Display[]
  selected: string | undefined
  onSelect: (id: string) => void
  onBack: () => void
}) {
  const [query, setQuery] = useState("")
  const [brand, setBrand] = useState("")
  const [filter, setFilter] = useState<ScreenFilter | "">("")
  const favorites = useFavoriteScreens()
  const brands = useMemo(() => [...new Set(screens.map(brandOf))], [screens])
  const shown = screens.filter((d) => (!brand || brandOf(d) === brand) && screenMatches(d, query.trim(), filter))
  const starred = favorites.map((id) => shown.find((d) => d.id === id)).filter((d): d is Display => !!d)
  const rest = shown.filter((d) => !favorites.includes(d.id))
  const groups = [
    { brand: "Favorites", items: starred },
    ...brands.map((b) => ({ brand: b, items: rest.filter((d) => brandOf(d) === b) })),
  ].filter((g) => g.items.length > 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid gap-3.5 border-b px-6 pt-[18px] pb-4">
        <div className="flex items-center gap-2.5">
          <Button variant="outline" size="icon" onClick={onBack} aria-label="Back to launch">
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-semibold">Choose a device</DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              {screens.length} screens: generic sizes and real phones with their cutouts and rounded corners
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="outline" size="icon" aria-label="Close">
              <XIcon />
            </Button>
          </DialogClose>
        </div>
        <label className="bg-muted text-muted-foreground flex h-9 items-center gap-2 rounded-[10px] border px-3">
          <SearchIcon className="size-4 shrink-0" />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Brand, model, resolution or a phone it looks like"
            aria-label="Search devices"
            className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <span className="hidden text-xs sm:inline">e.g. “720x1600”, “notch”</span>
        </label>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {["", ...brands].map((b) => (
            <Chip key={b || "all"} selected={b === brand} onSelect={() => setBrand(b)}>
              {b || "All"}
              <Count>{b ? screens.filter((d) => brandOf(d) === b).length : screens.length}</Count>
            </Chip>
          ))}
          <span aria-hidden className="bg-border mx-1 my-1 w-px shrink-0" />
          {screenFilters.map((f) => (
            <Chip
              key={f.id}
              selected={filter === f.id}
              aria-pressed={filter === f.id}
              onSelect={() => setFilter(filter === f.id ? "" : f.id)}
            >
              {f.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-[18px] pb-6">
        {groups.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-sm">
            {query.trim() ? `Nothing matches “${query.trim()}”.` : "No screen fits these filters."}
          </p>
        ) : (
          <div className="grid gap-[22px]">
            {groups.map((g) => (
              <section key={g.brand} className="grid gap-2.5">
                <h4 className="text-muted-foreground text-xs font-semibold tracking-[.06em] uppercase">
                  {g.brand} · {g.items.length}
                </h4>
                <div role="radiogroup" aria-label={g.brand} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {g.items.map((d) => (
                    <ScreenTile
                      key={d.id}
                      display={d}
                      selected={d.id === selected}
                      favorite={favorites.includes(d.id)}
                      onSelect={() => onSelect(d.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ScreenTile({
  display: d,
  selected,
  favorite,
  onSelect,
}: {
  display: Display
  selected: boolean
  favorite: boolean
  onSelect: () => void
}) {
  return (
    <div className="relative">
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className={cn(optionClass(selected), "flex-row items-center gap-3.5 py-3 pr-10 pl-3")}
      >
        <span className="grid w-[52px] shrink-0 place-items-center">
          <PhonePreview display={d} className="text-muted-foreground h-[58px]" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{screenName(d)}</span>
          <span className="text-muted-foreground font-mono text-[11.5px]">{screenFacts(d)}</span>
          <span className="text-muted-foreground truncate text-xs">
            {cutoutName(d)}
            {d.like ? ` · like ${d.like}` : ""}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-pressed={favorite}
        aria-label={`${favorite ? "Remove" : "Add"} ${screenName(d)} ${favorite ? "from" : "to"} favorites`}
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        onClick={() => toggleFavoriteScreen(d.id)}
        className="hover:bg-muted focus-visible:ring-ring/50 absolute top-2 right-2 grid size-7 place-items-center rounded-lg outline-none focus-visible:ring-3"
      >
        <StarIcon className={cn("size-4", favorite ? "fill-warning text-warning" : "text-muted-foreground")} />
      </button>
    </div>
  )
}
