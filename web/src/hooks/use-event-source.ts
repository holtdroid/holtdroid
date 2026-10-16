import { useEffect, useEffectEvent } from "react"

export function useEventSource<T extends Record<string, unknown>>(
  url: string | null,
  handlers: { [K in keyof T & string]: (data: T[K]) => void },
) {
  const deliver = useEffectEvent((event: keyof T & string, raw: string) => {
    let data: T[typeof event]
    try {
      data = JSON.parse(raw) as T[typeof event]
    } catch {
      return
    }
    handlers[event](data)
  })
  const events = Object.keys(handlers).toSorted().join(",")

  useEffect(() => {
    if (!url) return undefined
    const source = new EventSource(url)
    const listeners = events.split(",").map((event) => {
      const listener = (e: MessageEvent<string>) => deliver(event, e.data)
      source.addEventListener(event, listener)
      return [event, listener] as const
    })
    return () => {
      for (const [event, listener] of listeners) source.removeEventListener(event, listener)
      source.close()
    }
  }, [url, events])
}
