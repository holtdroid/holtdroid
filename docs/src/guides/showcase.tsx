import {
  ArrowRightIcon,
  BugIcon,
  CodeXmlIcon,
  GlobeIcon,
  type LucideIcon,
  RocketIcon,
  RulerIcon,
  SmartphoneIcon,
} from "lucide-react"
import { Suspense, use, useState } from "react"
import { cn } from "@/lib/utils"
import css from "./guides.css?inline"
import { Player } from "./player"
import { loadScenario } from "./scenarios"

type Scene = { guide: string; label: string; blurb: string; icon: LucideIcon; href: string }

const base = "/holtdroid/guides"

export const scenes: Scene[] = [
  {
    guide: "launch-app",
    label: "Launch a build",
    blurb: "Pick an APK, Android version, screen and country.",
    icon: RocketIcon,
    href: `${base}/first-steps/launch-app/`,
  },
  {
    guide: "session-tour",
    label: "The session",
    blurb: "The device, its tools and who else is looking.",
    icon: SmartphoneIcon,
    href: `${base}/first-steps/session-tour/`,
  },
  {
    guide: "devtools",
    label: "WebView DevTools",
    blurb: "Chrome DevTools on the app's WebViews, APK untouched.",
    icon: CodeXmlIcon,
    href: `${base}/web/devtools/`,
  },
  {
    guide: "vpn",
    label: "Country and VPN",
    blurb: "Move the device to another country mid-session.",
    icon: GlobeIcon,
    href: `${base}/conditions/vpn/`,
  },
  {
    guide: "pixel-perfect",
    label: "Pixel perfect",
    blurb: "Lay the Figma mock over the screen and compare.",
    icon: RulerIcon,
    href: `${base}/design/pixel-perfect/`,
  },
  {
    guide: "record-share",
    label: "Record a bug",
    blurb: "Video, logcat and network in one shareable link.",
    icon: BugIcon,
    href: `${base}/recordings/record-share/`,
  },
]

function Scene({ guide, onFinish }: { guide: string; onFinish: () => void }) {
  const sc = use(loadScenario(guide))
  return <Player sc={sc} lang="en" onFinish={onFinish} compact />
}

export default function Showcase() {
  const [index, setIndex] = useState(0)
  const scene = scenes[index]!
  return (
    <div className="hd-demo not-content grid items-start gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
      <style href="hd-guides" precedence="default">
        {css}
      </style>
      <div className="grid gap-3">
        <div
          role="tablist"
          aria-label="What you can do"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:overflow-visible md:p-0"
        >
          {scenes.map((s, i) => (
            <button
              key={s.guide}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => setIndex(i)}
              className={cn(
                "flex shrink-0 items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
                i === index
                  ? "bg-primary text-primary-foreground border-transparent"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground border-transparent",
              )}
            >
              <s.icon />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium whitespace-nowrap">{s.label}</span>
                <span className={cn("hidden text-xs leading-4 md:block", i === index ? "opacity-75" : "opacity-80")}>
                  {s.blurb}
                </span>
              </span>
            </button>
          ))}
        </div>
        <a
          href={scene.href}
          className="text-muted-foreground hover:text-foreground hidden items-center gap-1.5 px-3 text-xs no-underline md:flex [&_svg]:size-3.5"
        >
          Step-by-step guide
          <ArrowRightIcon />
        </a>
      </div>
      <Suspense fallback={<div className="aspect-[1180/720] rounded-xl border bg-[var(--sl-color-gray-6)]" />}>
        <Scene key={scene.guide} guide={scene.guide} onFinish={() => setIndex((index + 1) % scenes.length)} />
      </Suspense>
    </div>
  )
}
