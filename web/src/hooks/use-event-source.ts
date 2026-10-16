import { useEffect, useEffectEvent } from "react"

export function useEventSource<T>(url: string | null, event: string, onMessage: (data: T) => void) {
  const deliver = useEffectEvent((raw: string) => {
    try {
      onMessage(JSON.parse(raw) as T)
    } catch {
      return
    }
  })

  useEffect(() => {
    if (!url) return undefined
    const source = new EventSource(url)
    const listener = (e: MessageEvent<string>) => deliver(e.data)
    source.addEventListener(event, listener)
    return () => {
      source.removeEventListener(event, listener)
      source.close()
    }
  }, [url, event])
}
