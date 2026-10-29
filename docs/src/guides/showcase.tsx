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

type Scene = { guide: string; label: string; icon: LucideIcon; href: string }

const base = "/holtdroid/guides"

export const scenes: Scene[] = [
  { guide: "launch-app", label: "Launch a build", icon: RocketIcon, href: `${base}/first-steps/launch-app/` },
  { guide: "session-tour", label: "The session", icon: SmartphoneIcon, href: `${base}/first-steps/session-tour/` },
  { guide: "devtools", label: "WebView DevTools", icon: CodeXmlIcon, href: `${base}/web/devtools/` },
  { guide: "vpn", label: "Country and VPN", icon: GlobeIcon, href: `${base}/conditions/vpn/` },
  { guide: "pixel-perfect", label: "Pixel perfect", icon: RulerIcon, href: `${base}/design/pixel-perfect/` },
  { guide: "record-share", label: "Record a bug", icon: BugIcon, href: `${base}/recordings/record-share/` },
]

function Scene({ guide, onFinish }: { guide: string; onFinish: () => void }) {
  const sc = use(loadScenario(guide))
  return <Player sc={sc} lang="en" onFinish={onFinish} />
}

export default function Showcase() {
  const [index, setIndex] = useState(0)
  const scene = scenes[index]!
  return (
    <div className="hd-demo not-content grid gap-1">
      <style href="hd-guides" precedence="default">
        {css}
      </style>
      <div role="tablist" aria-label="What you can do" className="flex flex-wrap justify-center gap-2">
        {scenes.map((s, i) => (
          <button
            key={s.guide}
            type="button"
            role="tab"
            aria-selected={i === index}
            onClick={() => setIndex(i)}
            className={cn(
              "flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors [&_svg]:size-4",
              i === index
                ? "bg-primary text-primary-foreground border-transparent"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <s.icon />
            {s.label}
          </button>
        ))}
      </div>
      <Suspense fallback={<div className="my-6 aspect-[1180/820] rounded-xl border bg-[var(--sl-color-gray-6)]" />}>
        <Scene key={scene.guide} guide={scene.guide} onFinish={() => setIndex((index + 1) % scenes.length)} />
      </Suspense>
      <a
        href={scene.href}
        className="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1.5 text-sm no-underline [&_svg]:size-4"
      >
        Open “{scene.label}” as a step-by-step guide
        <ArrowRightIcon />
      </a>
    </div>
  )
}
