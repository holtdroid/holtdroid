import type { Display } from "@/api/client"
import { CutoutGraphic } from "@/components/session/cutout-graphic"
import { screenDp } from "@/lib/cutout"

const maxWidth = 190
const maxHeight = 340
const bezel = 6

export function LivePreview({ display }: { display?: Display }) {
  const { w, h } = display ? screenDp(display) : { w: 411, h: 914 }
  const scale = Math.min(maxWidth / w, maxHeight / h)
  const width = Math.round(w * scale)
  const height = Math.round(h * scale)
  const radius = Math.max(display?.radius ?? 0, 12) * scale + bezel
  return (
    <div className="flex items-center justify-center gap-3.5">
      {display && (
        <span className="text-muted-foreground rotate-180 font-mono text-xs [writing-mode:vertical-rl]">
          {display.height} px · {Math.round(h)} dp
        </span>
      )}
      <div className="flex flex-col items-center gap-2">
        <div
          className="border-foreground bg-card relative box-content overflow-hidden"
          style={{ width, height, borderWidth: bezel, borderRadius: radius }}
        >
          <div className="absolute inset-x-3 top-[30px] bottom-[18px] flex flex-col gap-2" aria-hidden>
            <div className="bg-border h-2.5 w-3/5 rounded" />
            <div className="bg-border h-[70px] rounded-lg" />
            <div className="grid grid-cols-2 gap-1.5">
              <div className="bg-border h-[60px] rounded-md" />
              <div className="bg-border h-[60px] rounded-md" />
            </div>
          </div>
          {display?.shape && (
            <svg viewBox={`0 0 ${w} ${h}`} className="text-foreground absolute inset-0 size-full" aria-hidden>
              <CutoutGraphic shape={display.shape} widthDp={w} fill="currentColor" details={false} />
            </svg>
          )}
        </div>
        {display && (
          <span className="text-muted-foreground font-mono text-xs">
            {display.width} px · {Math.round(w)} dp
          </span>
        )}
      </div>
    </div>
  )
}
