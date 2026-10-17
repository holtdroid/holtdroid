import { useSyncExternalStore } from "react"

const events = ["pointerdown", "pointerup", "keydown", "touchend", "click"] as const

function subscribe(onChange: () => void) {
  for (const e of events) window.addEventListener(e, onChange, { capture: true, passive: true })
  return () => {
    for (const e of events) window.removeEventListener(e, onChange, { capture: true })
  }
}

export function useUserActivation() {
  return useSyncExternalStore(subscribe, () => navigator.userActivation?.hasBeenActive ?? true)
}
