let timer: ReturnType<typeof setInterval> | undefined

self.addEventListener("message", (e: MessageEvent<number>) => {
  clearInterval(timer)
  if (e.data > 0) timer = setInterval(() => self.postMessage(0), e.data)
})
