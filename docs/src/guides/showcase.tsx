import {
  BugIcon,
  CodeXmlIcon,
  GlobeIcon,
  ImageIcon,
  type LucideIcon,
  RocketIcon,
  RulerIcon,
  SignpostIcon,
  SmartphoneIcon,
} from "lucide-react"
import { Suspense, use, useState, useTransition } from "react"
import { cn } from "@/lib/utils"
import css from "./guides.css?inline"
import { Player } from "./player"
import { loadScenario } from "./scenarios"

type Scene = { guide: string; label: string; icon: LucideIcon; href: string }

const base = "/guides"

export const scenes: Scene[] = [
  { guide: "launch-app", label: "Launch", icon: RocketIcon, href: `${base}/first-steps/launch-app/` },
  { guide: "session-tour", label: "Session", icon: SmartphoneIcon, href: `${base}/first-steps/session-tour/` },
  { guide: "devtools", label: "DevTools", icon: CodeXmlIcon, href: `${base}/web/devtools/` },
  { guide: "vpn", label: "VPN", icon: GlobeIcon, href: `${base}/conditions/vpn/` },
  { guide: "dns-routes", label: "DNS", icon: SignpostIcon, href: `${base}/conditions/dns-routes/` },
  { guide: "images-svg", label: "Images", icon: ImageIcon, href: `${base}/web/images-svg/` },
  { guide: "pixel-perfect", label: "Pixel perfect", icon: RulerIcon, href: `${base}/design/pixel-perfect/` },
  { guide: "record-share", label: "Recordings", icon: BugIcon, href: `${base}/recordings/record-share/` },
]

function Scene({ guide, onFinish }: { guide: string; onFinish: () => void }) {
  const sc = use(loadScenario(guide))
  return <Player sc={{ ...sc, steps: sc.steps.slice(0, 4) }} lang="en" onFinish={onFinish} compact pace={0.3} />
}

for (const s of scenes) void loadScenario(s.guide)

export default function Showcase() {
  const [index, setIndex] = useState(0)
  const [, startTransition] = useTransition()
  const show = (i: number) => startTransition(() => setIndex(i))
  const scene = scenes[index]!
  return (
    <div className="hd-demo not-content grid gap-6">
      <style href="hd-guides" precedence="default">
        {css}
      </style>
      <div
        role="tablist"
        aria-label="What you can do"
        className="flex w-fit max-w-full justify-self-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1"
      >
        {scenes.map((s, i) => (
          <button
            key={s.guide}
            type="button"
            role="tab"
            aria-selected={i === index}
            onClick={() => show(i)}
            className={cn(
              "flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors [&_svg]:size-4",
              i === index ? "bg-[#3ddc84] text-[#06210f]" : "text-neutral-400 hover:bg-white/5 hover:text-white",
            )}
          >
            <s.icon />
            {s.label}
          </button>
        ))}
      </div>
      <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-2 shadow-[0_40px_120px_-40px_rgb(61_220_132/0.35)]">
        <Suspense fallback={<div className="aspect-[1180/760] rounded-xl bg-white/[0.03]" />}>
          <Scene key={scene.guide} guide={scene.guide} onFinish={() => show((index + 1) % scenes.length)} />
        </Suspense>
      </div>
      <a
        href={scene.href}
        className="justify-self-center text-sm text-neutral-400 no-underline transition-colors hover:text-white"
      >
        Open this as a step-by-step guide →
      </a>
    </div>
  )
}
