const copiedEvent = "holtdroid:copied"

export function copyText(text: string) {
  return navigator.clipboard.writeText(text).then(() => {
    window.dispatchEvent(new CustomEvent(copiedEvent, { detail: text }))
  })
}

export function onCopied(listener: (text: string) => void) {
  const handle = (e: Event) => listener((e as CustomEvent<string>).detail)
  window.addEventListener(copiedEvent, handle)
  return () => window.removeEventListener(copiedEvent, handle)
}
