import {
  BatteryLowIcon,
  BatteryMediumIcon,
  CircleIcon,
  GlobeIcon,
  LockIcon,
  MapPinIcon,
  SearchIcon,
  ShoppingCartIcon,
  SignalIcon,
  SquareIcon,
  TriangleIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { PortalState } from "../types"
import { app, issues, locationOf, places, zones } from "./data"

const copy = {
  en: {
    hi: "Hi, Alex",
    welcome: "Welcome to Pinecone",
    signin: "Sign in",
    search: "Search cones and seeds",
    deliver: "Delivering to",
    buy: "Buy",
    popular: "Popular today",
    today: "Today",
  },
  uk: {
    hi: "Привіт, Алекс",
    welcome: "Вітаємо в Pinecone",
    signin: "Увійти",
    search: "Пошук шишок і насіння",
    deliver: "Доставка до",
    buy: "Купити",
    popular: "Популярне сьогодні",
    today: "Сьогодні",
  },
  de: {
    hi: "Hallo, Alex",
    welcome: "Willkommen bei Pinecone",
    signin: "Anmelden",
    search: "Zapfen und Samen suchen",
    deliver: "Lieferung nach",
    buy: "Kaufen",
    popular: "Heute beliebt",
    today: "Heute",
  },
}

const products = [
  { name: "Cedar cone", hue: "#b45309" },
  { name: "Pine seeds", hue: "#15803d" },
  { name: "Fir cone", hue: "#0f766e" },
  { name: "Larch set", hue: "#a16207" },
]

function StatusBar({ s }: { s: PortalState }) {
  const offline = s.network === "subway"
  return (
    <div className="flex h-7 shrink-0 items-center justify-between px-5 text-[11px] font-medium">
      <span className="tabular-nums">{zones[s.timeZone].time}</span>
      <span className="flex items-center gap-1">
        {s.recording && <CircleIcon className="size-2.5 fill-red-500 text-red-500" />}
        <SignalIcon className="size-3" />
        {offline ? <WifiOffIcon className="size-3" /> : <WifiIcon className="size-3" />}
        {s.battery <= 15 ? (
          <BatteryLowIcon className="size-3.5 text-red-500" />
        ) : (
          <BatteryMediumIcon className="size-3.5" />
        )}
        <span className="tabular-nums">{s.battery}%</span>
      </span>
    </div>
  )
}

function NavBar() {
  return (
    <div className="flex h-9 shrink-0 items-center justify-around px-12 opacity-70">
      <TriangleIcon className="size-3 -rotate-90" />
      <CircleIcon className="size-3" />
      <SquareIcon className="size-3" />
    </div>
  )
}

function Shop({ s }: { s: PortalState }) {
  const t = copy[s.locale]
  const loc = locationOf(s.location)
  const slow = s.network === "edge" || s.network === "hspa"
  if (s.dataCleared) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div className="grid justify-items-center gap-4">
          <img src={app.icon} alt="" className="size-20 rounded-3xl" />
          <div className="text-lg font-semibold">{t.welcome}</div>
          <div className="rounded-full bg-teal-700 px-8 py-2.5 text-sm font-medium text-white">{t.signin}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] opacity-60">{t.today}</div>
          <div className="text-lg font-semibold">{t.hi}</div>
        </div>
        <ShoppingCartIcon className="size-5" />
      </div>
      <div
        data-g="phone-search"
        className={cn(
          "flex h-9 items-center gap-2 rounded-full px-3 text-xs",
          s.dark ? "bg-neutral-800" : "bg-neutral-100",
        )}
      >
        <SearchIcon className="size-3.5 opacity-60" />
        <span className={cn(!s.phoneText && "opacity-50")}>{s.phoneText || t.search}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] opacity-70">
        <MapPinIcon className="size-3" />
        {t.deliver} {places[s.geo].name}
      </div>
      <div className="text-xs font-semibold">{t.popular}</div>
      <div className="grid grid-cols-2 gap-2.5">
        {products.map((p, i) => (
          <div
            key={p.name}
            data-g={i === 0 ? "phone-product" : undefined}
            className={cn("grid gap-1.5 rounded-2xl p-2", s.dark ? "bg-neutral-800" : "bg-neutral-100")}
          >
            <div className="h-16 rounded-xl" style={{ background: `linear-gradient(135deg, ${p.hue}, ${p.hue}88)` }} />
            <div className="truncate text-[11px] font-medium">{p.name}</div>
            {slow && i > 1 ? (
              <div className="h-3 w-12 animate-pulse rounded bg-neutral-400/40" />
            ) : (
              <div
                data-g={i === 0 ? "phone-price" : undefined}
                className="text-xs font-semibold text-teal-700 dark:text-teal-400"
              >
                {loc ? `${loc.price} ${loc.currency}` : "24.90 €"}
              </div>
            )}
          </div>
        ))}
      </div>
      <div
        data-g="phone-buy"
        className="mt-auto mb-2 rounded-full bg-teal-700 py-2.5 text-center text-sm font-medium text-white"
      >
        {t.buy}
      </div>
    </div>
  )
}

function Launcher() {
  return (
    <div className="grid flex-1 content-end gap-6 bg-gradient-to-b from-sky-800 to-indigo-900 p-6 pb-10 text-white">
      <div className="text-center text-4xl font-light tabular-nums">12:04</div>
      <div className="grid grid-cols-4 gap-4">
        {["#ef4444", "#22c55e", "#3b82f6", "#eab308"].map((c) => (
          <span key={c} className="mx-auto size-10 rounded-2xl" style={{ background: c }} />
        ))}
        <img src={app.icon} alt="" className="mx-auto size-10 rounded-2xl" />
      </div>
    </div>
  )
}

function DevPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-3 flex h-8 items-center gap-2 rounded-full bg-neutral-100 px-3 text-[11px] text-neutral-700">
        <LockIcon className="size-3" />
        localhost:5173
      </div>
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div className="grid justify-items-center gap-3">
          <div className="grid size-14 place-items-center rounded-2xl bg-violet-600 text-2xl font-bold text-white">
            V
          </div>
          <div className="font-semibold">pinecone-web · dev</div>
          <div className="text-xs opacity-60">Served by Vite from your laptop</div>
          <div className="rounded-lg bg-neutral-100 px-3 py-1.5 font-mono text-[10px] text-neutral-700">
            hmr connected
          </div>
        </div>
      </div>
    </div>
  )
}

function CrashDialog() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-black/40 p-5">
      <div className="grid w-full gap-4 rounded-3xl bg-white p-5 text-neutral-900 shadow-xl">
        <div className="text-sm font-medium">{app.label} keeps stopping</div>
        <div className="grid gap-2 text-xs">
          <span>App info</span>
          <span>Close app</span>
        </div>
      </div>
    </div>
  )
}

function Reference({ s }: { s: PortalState }) {
  return (
    <div className="pointer-events-none absolute inset-0" style={{ opacity: s.ppOpacity / 100 }}>
      <div className="absolute inset-x-4 top-[60px] h-6 rounded bg-fuchsia-500/60" />
      <div className="absolute inset-x-4 top-[100px] h-9 rounded-full bg-fuchsia-500/50" />
      <div className="absolute inset-x-4 top-[200px] grid h-48 grid-cols-2 gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl bg-fuchsia-500/40" />
        ))}
      </div>
      <div className="absolute inset-x-4 bottom-[54px] h-10 rounded-full bg-fuchsia-500/60" />
    </div>
  )
}

export function PhoneScreen({ s }: { s: PortalState }) {
  const dark = s.dark
  return (
    <div
      data-g="phone"
      className={cn(
        "relative flex size-full flex-col overflow-hidden",
        dark ? "bg-neutral-950 text-neutral-100" : "bg-white text-neutral-900",
      )}
    >
      <StatusBar s={s} />
      {s.phoneUrl === "dev" ? <DevPage /> : s.appRunning ? <Shop s={s} /> : <Launcher />}
      <NavBar />
      {s.crashed && <CrashDialog />}
      {s.ppReference && <Reference s={s} />}
      {s.ppCompare &&
        issues.map((issue, i) => (
          <div
            key={issue.title}
            data-g={`pp-issue-${i}`}
            className={cn(
              "absolute rounded-sm border-2",
              i === s.ppIssue ? "border-red-500 bg-red-500/20" : "border-amber-400/80",
            )}
            style={{ left: `${issue.x}%`, top: `${issue.y}%`, width: `${issue.w}%`, height: `${issue.h}%` }}
          />
        ))}
      {s.battery <= 15 && s.appRunning && !s.crashed && (
        <div className="absolute inset-x-3 top-8 flex items-center gap-2 rounded-2xl bg-neutral-800/95 p-3 text-xs text-white shadow-lg">
          <BatteryLowIcon className="size-4 text-red-400" />
          Battery low · {s.battery}% left
        </div>
      )}
      {s.locationBusy && (
        <div className="absolute inset-0 grid place-items-center bg-white/40">
          <GlobeIcon className="size-8 animate-spin text-teal-700" />
        </div>
      )}
    </div>
  )
}

export function Phone({ s }: { s: PortalState }) {
  return (
    <div className="relative rounded-[42px] bg-neutral-900 p-2.5 shadow-lg ring-1 ring-black/50 dark:ring-white/15">
      <div className="h-[600px] w-[280px] overflow-hidden rounded-[34px]">
        <PhoneScreen s={s} />
      </div>
      <PhoneButtons />
    </div>
  )
}

function PhoneButtons() {
  return (
    <div data-g="phone-buttons" className="absolute top-28 -right-1.5 grid w-1.5 gap-3">
      <span className="h-12 rounded-r bg-neutral-700" />
      <span className="h-20 rounded-r bg-neutral-700" />
    </div>
  )
}
