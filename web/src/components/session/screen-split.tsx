import { MoveHorizontalIcon, MoveVerticalIcon } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { usePanelRef } from "react-resizable-panels"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"
import { cn } from "@/lib/utils"

const minShare = 0.2
const maxShare = 0.7
const placeholderRatio = 320 / 640

export function ScreenSplit({ children: [screen, rail, tools] }: { children: [ReactNode, ReactNode, ReactNode] }) {
  const { autoFit } = useScreenPrefs()
  const panel = usePanelRef()
  const area = useRef<HTMLDivElement>(null)
  const row = useRef<HTMLDivElement>(null)
  const display = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const [edge, setEdge] = useState<number | null>(null)
  const [vertical, setVertical] = useState(false)

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
    if (!box || !line || !view) return undefined
    const fit = () => {
      const canvas = view.querySelector("canvas")
      const ratio =
        canvas?.hasAttribute("width") && canvas.width > 0 && canvas.height > 0
          ? canvas.width / canvas.height
          : placeholderRatio
      const across = ratio > 1
      if (across !== vertical) {
        setVertical(across)
        return
      }
      if (!autoFit) return
      const frame = view.querySelector<HTMLElement>("[data-inset-x]")
      const insetX = Number(frame?.dataset.insetX ?? 0)
      const insetY = Number(frame?.dataset.insetY ?? 0)
      if (vertical) {
        const want = (view.clientWidth - insetX) / ratio + insetY + line.clientHeight - view.clientHeight
        const height = Math.round(Math.min(Math.max(want, box.clientHeight * minShare), box.clientHeight * maxShare))
        if (Math.abs(height - line.clientHeight) > 1) panel.current?.resize(`${height}px`)
        return
      }
      const want = (view.clientHeight - insetY) * ratio + insetX + line.clientWidth - view.clientWidth
      const width = Math.round(Math.min(Math.max(want, box.clientWidth * minShare), box.clientWidth * maxShare))
      if (Math.abs(width - line.clientWidth) > 1) panel.current?.resize(`${width}px`)
    }
    const resized = new ResizeObserver(fit)
    resized.observe(box)
    resized.observe(line)
    resized.observe(view)
    const mutated = new MutationObserver(fit)
    mutated.observe(view, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["width", "height", "data-inset-x", "data-inset-y"],
    })
    fit()
    return () => {
      resized.disconnect()
      mutated.disconnect()
    }
  }, [autoFit, panel, vertical])

  return (
    <div ref={area} className="group/split relative size-full">
      <ResizablePanelGroup
        orientation={vertical ? "vertical" : "horizontal"}
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
              style={vertical ? { top: edge } : { left: edge }}
              className={cn(
                "absolute z-20 grid size-7 cursor-pointer",
                vertical ? "left-1/2 mt-2 -translate-x-1/2" : "top-1/2 ml-2 -translate-y-1/2",
                "place-items-center rounded-md bg-white/10 text-white/70 opacity-0 backdrop-blur transition-opacity delay-300 hover:bg-white/20 hover:text-white hover:opacity-100 hover:delay-0 focus-visible:opacity-100 focus-visible:delay-0 group-has-[[data-slot=resizable-handle]:hover]/split:opacity-100 group-has-[[data-slot=resizable-handle]:hover]/split:delay-0 [&_svg]:size-4",
                autoFit && "text-white",
              )}
            >
              {vertical ? <MoveVerticalIcon /> : <MoveHorizontalIcon />}
              <span className="sr-only">Fit to the screen</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side={vertical ? "bottom" : "right"}>
            {autoFit ? "Follows the screen; drag the handle to size it yourself" : "Fit the panel to the screen"}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
