import { ProportionsIcon } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { usePanelRef } from "react-resizable-panels"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"
import { cn } from "@/lib/utils"

const minShare = 0.2
const maxShare = 0.7

export function ScreenSplit({ children: [screen, rail, tools] }: { children: [ReactNode, ReactNode, ReactNode] }) {
  const { autoFit } = useScreenPrefs()
  const panel = usePanelRef()
  const area = useRef<HTMLDivElement>(null)
  const row = useRef<HTMLDivElement>(null)
  const display = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const [edge, setEdge] = useState<number | null>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && toggle.current?.contains(e.target)) e.preventDefault()
    }
    window.addEventListener("pointerdown", onDown, true)
    return () => window.removeEventListener("pointerdown", onDown, true)
  }, [])

  useEffect(() => {
    const box = area.current
    const line = row.current
    const view = display.current
    if (!autoFit || !box || !line || !view) return undefined
    const fit = () => {
      const canvas = view.querySelector("canvas")
      if (!canvas?.width || !canvas.height) return
      const want = (view.clientHeight * canvas.width) / canvas.height + line.clientWidth - view.clientWidth
      const width = Math.round(Math.min(Math.max(want, box.clientWidth * minShare), box.clientWidth * maxShare))
      if (Math.abs(width - line.clientWidth) > 1) panel.current?.resize(`${width}px`)
    }
    const resized = new ResizeObserver(fit)
    resized.observe(box)
    resized.observe(line)
    const mutated = new MutationObserver(fit)
    mutated.observe(view, { subtree: true, childList: true, attributes: true, attributeFilter: ["width", "height"] })
    fit()
    return () => {
      resized.disconnect()
      mutated.disconnect()
    }
  }, [autoFit, panel])

  return (
    <div ref={area} className="relative size-full">
      <ResizablePanelGroup
        orientation="horizontal"
        onLayoutChanged={(_, meta) => {
          if (meta.isUserInteraction && autoFit) setScreenPrefs({ autoFit: false })
        }}
      >
        <ResizablePanel panelRef={panel} defaultSize="42" minSize="20" onResize={(size) => setEdge(size.inPixels)}>
          <div ref={row} className="flex size-full">
            <div ref={display} className="min-w-0 flex-1">
              {screen}
            </div>
            {rail}
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="58" minSize="20">
          {tools}
        </ResizablePanel>
      </ResizablePanelGroup>
      {edge !== null && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={toggle}
              type="button"
              aria-pressed={autoFit}
              onClick={() => setScreenPrefs({ autoFit: !autoFit })}
              style={{ left: edge }}
              className={cn(
                "bg-background text-muted-foreground hover:text-foreground absolute top-1/2 z-20 grid size-6 -translate-x-1/2 -translate-y-[calc(100%+1rem)] cursor-pointer place-items-center rounded-full border shadow-sm [&_svg]:size-3.5",
                autoFit && "border-primary text-primary",
              )}
            >
              <ProportionsIcon />
              <span className="sr-only">Fit to the screen</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {autoFit ? "Follows the screen; drag the handle to size it yourself" : "Fit the panel to the screen"}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
