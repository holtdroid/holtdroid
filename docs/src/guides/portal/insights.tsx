import {
  ArrowRightIcon,
  CircleIcon,
  EraserIcon,
  FlagIcon,
  LayersIcon,
  PauseIcon,
  ScanEyeIcon,
  SmartphoneIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WandSparklesIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { PortalState } from "../types"

function Bar({ children }: { children: ReactNode }) {
  return <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">{children}</div>
}

function Mark({ tone, children }: { tone: "violet" | "amber" | "red" | "muted"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-px font-sans text-[10px] font-medium",
        tone === "violet" && "bg-violet-500/15 text-violet-700 dark:text-violet-300",
        tone === "amber" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        tone === "red" && "bg-red-500/15 text-red-700 dark:text-red-300",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

function Stat({ label, value, tone, g }: { label: string; value: string; tone?: "amber" | "green"; g?: string }) {
  return (
    <div data-g={g} className="grid gap-0.5 rounded-lg border px-3 py-2">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "amber" && "text-amber-600 dark:text-amber-400",
          tone === "green" && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </span>
    </div>
  )
}

const queries = [
  { id: "shop", time: "12:04:01", name: "shop.example.com", types: "A HTTPS", answer: "104.18.22.7 · alpn h3, h2" },
  { id: "api", time: "12:04:01", name: "api.shop.example.com", types: "A", answer: "185.199.110.4" },
  { id: "img", time: "12:04:02", name: "img.example-cdn.com.br", types: "A", answer: "200.147.3.157" },
  { id: "ads", time: "12:04:02", name: "metrics.example-ads.com", types: "A", answer: "" },
  { id: "doh", time: "12:04:03", name: "dns.google", types: "A", answer: "" },
] as const

export function Dns({ s }: { s: PortalState }) {
  return (
    <div className="flex h-full flex-col">
      <Bar>
        <span data-g="dns-views" className="bg-muted flex rounded-md p-0.5 text-xs font-medium">
          <span className={cn("rounded px-2 py-1", s.dnsView === "queries" && "bg-background shadow-sm")}>Queries</span>
          <span
            data-g="dns-rewrites-tab"
            className={cn("rounded px-2 py-1", s.dnsView === "rewrites" && "bg-background shadow-sm")}
          >
            Rewrites {s.dnsRewrite ? 1 : 0}
          </span>
        </span>
        <Badge data-g="dns-ttl" variant="outline" className="font-mono">
          TTL 0 s
        </Badge>
        <span data-g="dns-doh" className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Switch checked size="sm" />
          Block DoH
        </span>
        <Button size="icon-sm" variant="ghost" className="ml-auto" title="Clear DNS cache">
          <EraserIcon />
        </Button>
      </Bar>
      {s.dnsView === "queries" ? (
        <>
          <div className="font-mono text-[11px]">
            {queries.map((q) => {
              const rewritten = q.id === "api" && s.dnsRewrite
              return (
                <div
                  key={q.id}
                  data-g={`dns-row-${q.id}`}
                  className={cn(
                    "grid grid-cols-[56px_minmax(0,1fr)_minmax(0,1.1fr)_18px] items-center gap-2 border-b px-2 py-1.5",
                    s.dnsQuery === q.id && "bg-sky-100 dark:bg-sky-950",
                  )}
                >
                  <span className="text-muted-foreground">{q.time}</span>
                  <span className="truncate">
                    {q.name} <span className="text-muted-foreground">{q.types}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    {rewritten ? (
                      <>
                        <span className="truncate">10.0.4.12</span>
                        <Mark tone="violet">rewrite</Mark>
                      </>
                    ) : q.id === "ads" ? (
                      <Mark tone="amber">NXDOMAIN</Mark>
                    ) : q.id === "doh" ? (
                      <>
                        <Mark tone="muted">DoH blocked</Mark>
                        <span className="text-muted-foreground">×12</span>
                      </>
                    ) : (
                      <>
                        <span className="truncate">{q.answer}</span>
                        {q.id === "img" && <Mark tone="amber">far</Mark>}
                      </>
                    )}
                  </span>
                  <WandSparklesIcon
                    data-g={q.id === "api" ? "dns-wand" : undefined}
                    className="text-muted-foreground size-3.5"
                  />
                </div>
              )
            })}
          </div>
          {s.dnsQuery === "api" && (
            <div data-g="dns-details" className="m-2 grid gap-2 rounded-lg border p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-mono font-medium">api.shop.example.com</span>
                <Button data-g="dns-rewrite-btn" size="xs" variant="outline">
                  <WandSparklesIcon />
                  Rewrite this name…
                </Button>
              </div>
              <div className="text-muted-foreground grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[11px]">
                <span>CNAME</span>
                <span>api.shop.example.com → shop-api.eu-central.example.net</span>
                <span>A</span>
                <span>185.199.110.4 · Germany · Hetzner AS24940</span>
                <span>A</span>
                <span>185.199.111.4 · Germany · Hetzner AS24940</span>
                <span>TTL</span>
                <span>0s / 5m · 23 ms</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <div data-g="dns-rule" className="m-3 grid gap-3 rounded-lg border p-3 text-xs">
          <div className="flex items-center gap-2">
            <Switch checked={s.dnsRewrite} size="sm" />
            <span className="font-mono text-sm font-medium">api.shop.example.com</span>
            <Badge variant="secondary" className="ml-auto">
              answered 3
            </Badge>
          </div>
          <div className="grid gap-1.5">
            <span className="text-muted-foreground">Answer with</span>
            <div className="grid grid-cols-4 gap-1">
              {["IP address", "Block", "Other name", "Doesn't exist"].map((o, i) => (
                <span
                  key={o}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-center",
                    i === 0 && "border-primary bg-primary/5 font-medium",
                  )}
                >
                  {o}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[1fr_80px] gap-2">
            <span className="rounded-md border px-2 py-1.5 font-mono">10.0.4.12</span>
            <span className="rounded-md border px-2 py-1.5 font-mono">TTL 0</span>
          </div>
          <p className="text-muted-foreground">
            Matches 3 names seen in this session. Android's DNS cache was cleared.
          </p>
        </div>
      )}
    </div>
  )
}

const routes = [
  {
    id: "shop",
    name: "shop.example.com",
    addr: "104.18.22.7",
    where: "anycast · Cloudflare · AMS",
    conns: "3 (1)",
    bytes: "1.2 MB",
    flag: "",
  },
  {
    id: "api",
    name: "api.shop.example.com",
    addr: "185.199.110.4 +1",
    where: "Germany · Hetzner",
    conns: "14 (2)",
    bytes: "84 KB",
    flag: "no reuse",
  },
  {
    id: "img",
    name: "img.example-cdn.com.br",
    addr: "200.147.3.157",
    where: "Brazil · UOL",
    conns: "2",
    bytes: "640 KB",
    flag: "far",
  },
  {
    id: "track",
    name: "track.example.net",
    addr: "93.184.215.14",
    where: "United States · Edgecast",
    conns: "1",
    bytes: "2 KB",
    flag: "HTTP",
  },
] as const

export function Routes({ s }: { s: PortalState }) {
  const rows = s.routesFlagged ? routes.filter((r) => r.flag) : routes
  return (
    <div className="flex h-full flex-col">
      <div data-g="routes-path" className="flex items-center gap-1.5 border-b px-3 py-2.5 text-xs">
        <span className="flex items-center gap-1 font-medium">
          <SmartphoneIcon className="size-3.5" />
          Device
        </span>
        <ArrowRightIcon className="text-muted-foreground size-3" />
        <Badge variant="secondary">VPN · Netherlands</Badge>
        <ArrowRightIcon className="text-muted-foreground size-3" />
        <span className="font-mono">185.107.56.12</span>
        <span className="text-muted-foreground">NL · M247</span>
        <ArrowRightIcon className="text-muted-foreground size-3" />
        <span className="text-muted-foreground">{routes.length} servers</span>
      </div>
      <Bar>
        <span
          data-g="routes-flagged"
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
            s.routesFlagged && "border-amber-500/50 bg-amber-500/10",
          )}
        >
          <FlagIcon className="size-3" />
          Flagged 3
        </span>
        <span className="border-input text-muted-foreground ml-auto flex h-7 w-36 items-center rounded-md border px-2 text-xs">
          Filter
        </span>
      </Bar>
      <div className="font-mono text-[11px]">
        <div className="text-muted-foreground grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_48px_52px] gap-2 border-b px-2 py-1 font-sans">
          <span>Name</span>
          <span>Where</span>
          <span>Conn.</span>
          <span>Received</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.id}
            data-g={`route-row-${r.id}`}
            className={cn(
              "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_48px_52px] items-center gap-2 border-b px-2 py-1.5",
              s.routeName === r.id && "bg-sky-100 dark:bg-sky-950",
            )}
          >
            <span className="grid min-w-0">
              <span className="truncate">{r.name}</span>
              <span className="text-muted-foreground truncate">{r.addr}</span>
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-1 font-sans">
              <span className="truncate">{r.where}</span>
              {r.flag && <Mark tone={r.flag === "HTTP" ? "red" : "amber"}>{r.flag}</Mark>}
            </span>
            <span>{r.conns}</span>
            <span>{r.bytes}</span>
          </div>
        ))}
      </div>
      {s.routeName === "api" && (
        <div data-g="route-details" className="m-2 grid gap-2 rounded-lg border p-3 text-xs">
          <span className="font-mono font-medium">api.shop.example.com</span>
          <p className="text-muted-foreground">
            14 TCP connections to :443 in 40 s. Each paid a TCP and a TLS handshake; keep-alive or HTTP/2 would carry
            them over one.
          </p>
          <div className="text-muted-foreground grid grid-cols-[64px_56px_minmax(0,1fr)_56px] gap-x-3 gap-y-0.5 font-mono text-[11px]">
            {["12:04:05", "12:04:07", "12:04:08", "12:04:11"].map((t, i) => (
              <span key={t} className="contents">
                <span>{t}</span>
                <span>{[180, 210, 160, 240][i]} ms</span>
                <span>TCP :443 · via nl</span>
                <span>{[6, 4, 9, 5][i]} KB</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Finding({
  g,
  warn,
  text,
  save,
  count,
  selected,
}: {
  g: string
  warn: boolean
  text: ReactNode
  save: string
  count: number
  selected: boolean
}) {
  return (
    <div
      data-g={g}
      className={cn(
        "grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2 border-b px-3 py-2 text-xs",
        selected && "bg-sky-100 dark:bg-sky-950",
      )}
    >
      {warn ? (
        <TriangleAlertIcon className="mt-0.5 size-3.5 text-amber-500" />
      ) : (
        <CircleIcon className="text-muted-foreground mt-0.5 size-3" />
      )}
      <span className="leading-4">{text}</span>
      <span className="text-muted-foreground font-mono text-[11px] whitespace-nowrap">
        −{save} ×{count}
      </span>
    </div>
  )
}

function Severity({ value, g }: { value: "all" | "warnings"; g?: string }) {
  return (
    <div className="flex gap-1 px-3 pt-3 pb-2 text-xs">
      {(["all", "warnings", "hints"] as const).map((k) => (
        <span
          key={k}
          data-g={k === "warnings" ? g : undefined}
          className={cn("rounded-full border px-2.5 py-0.5 capitalize", value === k && "bg-foreground text-background")}
        >
          {k}
        </span>
      ))}
    </div>
  )
}

export function Images({ s }: { s: PortalState }) {
  const findings = [
    {
      id: "banner",
      warn: true,
      scan: true,
      save: "688 KB",
      count: 1,
      text: (
        <>
          <b>promo-banner.png</b> wasn't on screen in the 10 s after it loaded
        </>
      ),
    },
    {
      id: "hero",
      warn: true,
      scan: true,
      save: "412 KB",
      count: 1,
      text: (
        <>
          <b>hero-2048.jpg</b> is 2048×1365 but drawn at 1080×720 device pixels at most
        </>
      ),
    },
    {
      id: "logo",
      warn: true,
      scan: false,
      save: "34 KB",
      count: 3,
      text: (
        <>
          <b>logo.png</b> is PNG: as WebP it would be about 41 KB instead of 75 KB
        </>
      ),
    },
    {
      id: "product",
      warn: false,
      scan: false,
      save: "18 KB",
      count: 2,
      text: (
        <>
          <b>product-42.webp</b> is heavy for its size: 3.1 bits per pixel
        </>
      ),
    },
  ].filter((f) => (s.imgScan || !f.scan) && (s.imgFilter === "all" || f.warn))
  return (
    <div className="flex h-full flex-col">
      <Bar>
        <Button size="icon-sm" variant="ghost">
          <PauseIcon />
        </Button>
        <Button size="icon-sm" variant="ghost">
          <Trash2Icon />
        </Button>
        {s.imgScan && (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <ScanEyeIcon className="size-3.5 text-emerald-500" />
            Image scan on · turn off
          </span>
        )}
        <span className="text-muted-foreground ml-auto text-xs">24 images</span>
      </Bar>
      {!s.imgScan && (
        <div className="m-3 mb-0 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs">
          <ScanEyeIcon className="text-muted-foreground size-4" />
          <span className="text-muted-foreground">This session doesn't check where its pages draw images</span>
          <Button data-g="img-scan-on" size="xs" variant="outline" className="ml-auto">
            Turn on
          </Button>
        </div>
      )}
      <div data-g="img-stats" className="grid grid-cols-4 gap-2 px-3 pt-3">
        <Stat label="Images" value="24" />
        <Stat label="Downloaded" value="3.4 MB" />
        <Stat label="Not on screen" value={s.imgScan ? "1.1 MB" : "—"} tone={s.imgScan ? "amber" : undefined} />
        <Stat label="Could save" value={s.imgScan ? "2.2 MB" : "52 KB"} tone="green" />
      </div>
      <Severity value={s.imgFilter} g="img-filter-warnings" />
      <div className="border-t">
        {findings.map((f) => (
          <Finding
            key={f.id}
            g={`img-finding-${f.id}`}
            warn={f.warn}
            text={f.text}
            save={f.save}
            count={f.count}
            selected={s.imgFinding === f.id}
          />
        ))}
      </div>
      {s.imgFinding !== "none" && (
        <div
          data-g="img-details"
          className="m-2 grid grid-cols-[88px_minmax(0,1fr)] gap-3 rounded-lg border p-3 text-xs"
        >
          <div
            className="aspect-square rounded-md border"
            style={{
              background:
                s.imgFinding === "hero"
                  ? "linear-gradient(135deg,#0f766e,#fbbf24)"
                  : "linear-gradient(135deg,#7c3aed,#f472b6)",
            }}
          />
          <div className="grid content-start gap-1">
            {s.imgFinding === "hero" ? (
              <>
                <span>
                  JPEG · <b>612 KB</b> · natural 2048×1365 · drawn at most <b>1080×720</b>
                </span>
                <span className="text-muted-foreground">WebP q85 284 KB · WebP at 1080 px 96 KB</span>
                <span className="text-muted-foreground">
                  Drawn by &lt;img&gt; 360×240 ×3 · object-fit cover ·{" "}
                  <span className="text-emerald-500">on screen</span>
                </span>
              </>
            ) : (
              <>
                <span>
                  PNG · <b>688 KB</b> · natural 1600×900
                </span>
                <span className="text-muted-foreground">
                  Drawn by CSS background 390×220 ×3 · <span className="text-amber-500">off screen</span>, 2400 px below
                  the fold
                </span>
                <span className="text-muted-foreground">
                  Load it later with <code className="font-mono">loading="lazy"</code>
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function Svg({ s }: { s: PortalState }) {
  return (
    <div className="flex h-full flex-col">
      <Bar>
        <Button size="icon-sm" variant="ghost">
          <PauseIcon />
        </Button>
        <Button size="icon-sm" variant="ghost">
          <Trash2Icon />
        </Button>
        <span className="text-muted-foreground ml-auto text-xs">1,284 paths</span>
      </Bar>
      <div data-g="svg-stats" className="grid grid-cols-4 gap-2 px-3 pt-3">
        <Stat label="Files" value="6" />
        <Stat label="Paths" value="1,284" />
        <Stat label="Path data" value="214 KB" />
        <Stat label="Could save" value="61 KB" tone="green" />
      </div>
      <Severity value="all" />
      <div className="border-t">
        <Finding
          g="svg-finding-decimals"
          warn
          text={
            <>
              <b>icons.js</b>: 120 of 340 paths keep up to 6 decimals, rounding saves 18 KB
            </>
          }
          save="18 KB"
          count={120}
          selected={s.svgFinding === "decimals"}
        />
        <Finding
          g="svg-finding-dupes"
          warn
          text={<>14 paths are shipped more than once: 12 KB</>}
          save="12 KB"
          count={14}
          selected={s.svgFinding === "dupes"}
        />
        <Finding
          g="svg-finding-commands"
          warn={false}
          text={
            <>
              <b>icons.js</b>: shorter path commands save another 3 KB
            </>
          }
          save="3 KB"
          count={340}
          selected={false}
        />
      </div>
      {s.svgFinding === "decimals" && (
        <div data-g="svg-details" className="m-2 grid gap-2 rounded-lg border p-3 text-xs">
          <span className="text-muted-foreground">
            viewBox 0 0 24 24 · a 24-unit icon needs 2 digits after the point
          </span>
          <code className="bg-muted rounded-md p-2 font-mono text-[11px] break-all text-red-600 dark:text-red-300">
            d="M12.000000 4.500000L18.250000 10.750000C18.666667 11.166667 …"
          </code>
          <code className="bg-muted rounded-md p-2 font-mono text-[11px] break-all text-emerald-700 dark:text-emerald-300">
            d="M12 4.5l6.25 6.25c.42.42 …"
          </code>
        </div>
      )}
      {s.svgFinding === "dupes" && (
        <div data-g="svg-details" className="m-2 grid gap-1.5 rounded-lg border p-3 text-xs">
          <span className="flex items-center gap-1.5 font-medium">
            <LayersIcon className="size-3.5" />
            cart icon · 1.1 KB · in 3 files
          </span>
          <span className="text-muted-foreground font-mono text-[11px]">vendor.js · main.js · checkout.js</span>
          <span className="text-muted-foreground">Import it from one module, or use an SVG sprite.</span>
        </div>
      )}
    </div>
  )
}
