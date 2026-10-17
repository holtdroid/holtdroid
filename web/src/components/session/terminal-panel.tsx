import "@xterm/xterm/css/xterm.css"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import type { Adb, AdbNoneProtocolPtyProcess, AdbShellProtocolPtyProcess } from "@yume-chan/adb"
import { WritableStream } from "@yume-chan/stream-extra"
import { RotateCcwIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

type Pty = AdbShellProtocolPtyProcess | AdbNoneProtocolPtyProcess

async function openPty(adb: Adb) {
  const shell = adb.subprocess.shellProtocol
  if (shell) {
    const p = await shell.pty({ terminalType: "xterm-256color" })
    return { process: p as Pty, resize: (rows: number, cols: number) => p.resize(rows, cols) }
  }
  const p = await adb.subprocess.noneProtocol.pty()
  return { process: p as Pty, resize: () => Promise.resolve() }
}

export function TerminalPanel({ adb }: { adb: Adb }) {
  const [run, setRun] = useState(0)
  return <Shell key={run} adb={adb} restart={() => setRun((n) => n + 1)} />
}

function Shell({ adb, restart }: { adb: Adb; restart: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const [exited, setExited] = useState(false)

  useEffect(() => {
    const el = container.current
    if (!el) return undefined
    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: "#0a0a0a" },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    let disposed = false
    let pty: Awaited<ReturnType<typeof openPty>> | undefined
    const encoder = new TextEncoder()

    const refit = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return
      fit.fit()
      void pty?.resize(term.rows, term.cols).catch(() => undefined)
    }
    const observer = new ResizeObserver(refit)
    observer.observe(el)

    void openPty(adb).then(
      (p) => {
        if (disposed) {
          void p.process.kill()
          return
        }
        pty = p
        refit()
        const writer = p.process.input.getWriter()
        const input = term.onData((data) => void writer.write(encoder.encode(data)).catch(() => undefined))
        void p.process.output
          .pipeTo(new WritableStream<Uint8Array>({ write: (chunk) => term.write(chunk) }))
          .catch(() => undefined)
          .finally(() => {
            input.dispose()
            if (disposed) return
            term.write("\r\n\x1b[2m[the shell exited]\x1b[0m\r\n")
            setExited(true)
          })
        term.focus()
      },
      (e: unknown) => {
        term.write(`\x1b[31mCould not start a shell: ${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`)
        setExited(true)
      },
    )

    return () => {
      disposed = true
      observer.disconnect()
      void pty?.process.kill()
      term.dispose()
    }
  }, [adb])

  return (
    <div className="relative flex h-full flex-col bg-[#0a0a0a]">
      <div ref={container} className="min-h-0 flex-1 p-2" />
      {exited && (
        <Button size="sm" variant="secondary" className="absolute top-2 right-4" onClick={restart}>
          <RotateCcwIcon />
          New shell
        </Button>
      )}
    </div>
  )
}
