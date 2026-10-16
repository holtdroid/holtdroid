import { useCallback, useEffect, useRef } from "react"
import { api } from "@/api/client"

const INTERVAL = 30_000
const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const

export function useActivityHeartbeat(provider: string, id: string) {
  const lastInput = useRef(0)
  const lastSent = useRef(0)

  const mark = useCallback(() => {
    lastInput.current = Date.now()
  }, [])

  useEffect(() => {
    lastInput.current = Date.now()
    for (const e of EVENTS) window.addEventListener(e, mark, { passive: true })
    const send = () => {
      if (document.visibilityState !== "visible") return
      const active = lastInput.current > lastSent.current
      lastSent.current = Date.now()
      void api.POST("/api/v1/sessions/{provider}/{id}/heartbeat", {
        params: { path: { provider, id } },
        body: { active },
      })
    }
    const timer = window.setInterval(send, INTERVAL)
    return () => {
      window.clearInterval(timer)
      for (const e of EVENTS) window.removeEventListener(e, mark)
    }
  }, [provider, id, mark])

  return useCallback(
    (frame: HTMLIFrameElement | null) => {
      if (!frame) return
      const attach = () => {
        try {
          const win = frame.contentWindow
          if (!win) return
          for (const e of EVENTS) win.addEventListener(e, mark, { passive: true, capture: true })
        } catch {
          return
        }
      }
      frame.addEventListener("load", attach)
      attach()
    },
    [mark],
  )
}
