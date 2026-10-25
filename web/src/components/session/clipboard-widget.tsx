import { useMutation } from "@tanstack/react-query"
import {
  ArrowLeftRightIcon,
  ClipboardCheckIcon,
  ClipboardCopyIcon,
  ClipboardIcon,
  ClipboardPasteIcon,
  ClipboardXIcon,
  CopyIcon,
  DownloadIcon,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { agentClient, type Clipboard, sessionBase, unwrap } from "@/api/client"
import {
  CardLine,
  Note,
  Row,
  Section,
  ShadeCard,
  ShadeHeader,
  ShadePanel,
  Tile,
  ShadeRoot,
} from "@/components/session/shade"
import { HoverCardTrigger } from "@/components/ui/hover-card"
import { useEventSource } from "@/hooks/use-event-source"
import { download, stamp } from "@/lib/adb"
import { onCopied } from "@/lib/clipboard"
import { type ClipboardSync, setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"

const modes: Record<ClipboardSync, { label: string; hint: string; icon: LucideIcon }> = {
  both: { label: "Both ways", hint: "Copy on either side, paste on the other", icon: ArrowLeftRightIcon },
  "to-device": { label: "To the device", hint: "What you copy here reaches the device", icon: ClipboardPasteIcon },
  "from-device": {
    label: "From the device",
    hint: "What the device copies lands in your clipboard",
    icon: ClipboardCopyIcon,
  },
}

export function ClipboardWidget({ provider, id }: { provider: string; id: string }) {
  const { clipboard: on, clipboardSync } = useScreenPrefs()
  const mode = modes[clipboardSync] ? clipboardSync : "both"
  const { blocked, history } = useClipboardSync(provider, id, on ? mode : null)
  const summary = on ? modes[mode].label : "Off"

  return (
    <ShadeRoot>
      <HoverCardTrigger asChild>
        <ShadeCard
          aria-label={on ? "Turn clipboard sync off" : "Turn clipboard sync on"}
          changed={!on || mode !== "both"}
          className="cursor-pointer"
          onClick={() => setScreenPrefs({ clipboard: !on })}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <ClipboardIcon className="size-4 shrink-0 text-neutral-400" />
            <span className="truncate">Clipboard</span>
          </span>
          <CardLine icon={on ? modes[mode].icon : ClipboardXIcon}>{summary}</CardLine>
        </ShadeCard>
      </HoverCardTrigger>
      <ShadePanel>
        <ShadeHeader
          title="Clipboard sync"
          summary={on ? `${summary} · click the card to turn it off` : "Click the card to turn it on"}
        />
        <Tile
          icon={on ? ClipboardCheckIcon : ClipboardXIcon}
          label="Sync"
          on={on}
          wide
          onClick={() => setScreenPrefs({ clipboard: !on })}
        />
        <Section title="Direction">
          {(Object.entries(modes) as [ClipboardSync, (typeof modes)[ClipboardSync]][]).map(([m, info]) => (
            <Row
              key={m}
              selected={on && m === mode}
              icon={info.icon}
              title={info.label}
              onClick={() => setScreenPrefs({ clipboard: true, clipboardSync: m })}
            >
              {info.hint}
            </Row>
          ))}
        </Section>
        {on && blocked && mode !== "from-device" && (
          <Note>
            The browser doesn&apos;t let the page read your clipboard, so nothing goes to the device on its own.
          </Note>
        )}
        <Note>Ctrl/Cmd+V on the screen always pastes, with sync on or off.</Note>
        <History entries={history} />
      </ShadePanel>
    </ShadeRoot>
  )
}

function useClipboardSync(provider: string, id: string, mode: ClipboardSync | null) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const last = useRef<string | null>(null)
  const pending = useRef<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [history, setHistory] = useState<ClipEntry[]>([])
  const record = (text: string, to: boolean) =>
    setHistory((h) => [{ text, to, at: Date.now() }, ...h.filter((e) => e.text !== text)].slice(0, historySize))
  const toDevice = mode === "both" || mode === "to-device"
  const fromDevice = mode === "both" || mode === "from-device"

  const send = useMutation({
    mutationFn: (text: string) => unwrap(client.POST("/v1/clipboard", { body: { text } })),
    onSuccess: (_, text) => {
      record(text, true)
      toast("Sent to the device clipboard", { id: "clipboard", description: preview(text) })
    },
    onError: (e) => toast.error("Could not set the device clipboard", { id: "clipboard", description: e.message }),
  })

  const writeBrowser = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast("Copied from the device", { id: "clipboard", description: preview(text) }),
      () => {
        pending.current = text
      },
    )
  }

  useEventSource<{ clip: Clipboard }>(fromDevice ? `${sessionBase(provider, id)}/v1/clipboard/events` : null, {
    clip: (c) => {
      if (c.text === last.current) return
      last.current = c.text
      record(c.text, false)
      if (document.hasFocus()) writeBrowser(c.text)
      else pending.current = c.text
    },
  })

  const sync = useEffectEvent(() => {
    if (!document.hasFocus()) return
    const text = pending.current
    if (text !== null && fromDevice) {
      pending.current = null
      writeBrowser(text)
      return
    }
    if (!toDevice) return
    navigator.clipboard.readText().then(
      (t) => {
        setBlocked(false)
        if (!t || t === last.current) return
        last.current = t
        send.mutate(t)
      },
      () => setBlocked(true),
    )
  })

  const copied = useEffectEvent((text: string) => {
    if (!toDevice || !text || text === last.current) return
    last.current = text
    send.mutate(text)
  })

  useEffect(() => (mode ? onCopied((text) => copied(text)) : undefined), [mode])

  useEffect(() => {
    if (!mode) return undefined
    const now = () => sync()
    const later = () => setTimeout(now, 0)
    window.addEventListener("focus", now)
    document.addEventListener("copy", later)
    document.addEventListener("cut", later)
    now()
    return () => {
      window.removeEventListener("focus", now)
      document.removeEventListener("copy", later)
      document.removeEventListener("cut", later)
    }
  }, [mode])

  return { blocked, history }
}

const historySize = 10

type ClipEntry = { text: string; to: boolean; at: number }

function visible(text: string, limit = 160) {
  let out = ""
  for (const ch of text.replaceAll("\r\n", "\n")) {
    if (out.length >= limit) return `${out}…`
    const code = ch.charCodeAt(0)
    out +=
      ch === " "
        ? "·"
        : ch === "\n"
          ? "↵"
          : ch === "\t"
            ? "→"
            : code < 32 || code === 127
              ? String.fromCharCode(code === 127 ? 0x2421 : 0x2400 + code)
              : ch
  }
  return out
}

function describe(e: ClipEntry) {
  const lines = e.text.split("\n").length
  return [
    new Date(e.at).toLocaleTimeString(),
    `${e.text.length.toLocaleString()} ${e.text.length === 1 ? "char" : "chars"}`,
    lines > 1 && `${lines} lines`,
  ]
    .filter(Boolean)
    .join(" · ")
}

function copyEntry(text: string) {
  return navigator.clipboard.writeText(text).then(
    () => toast("Copied to your clipboard", { id: "clipboard", description: preview(text) }),
    (e: unknown) =>
      toast.error("Could not copy", { id: "clipboard", description: e instanceof Error ? e.message : String(e) }),
  )
}

function History({ entries }: { entries: ClipEntry[] }) {
  return (
    <section className="grid gap-1.5">
      <h4 className="px-1 text-xs font-medium text-neutral-400">Last {historySize} synced</h4>
      {entries.length === 0 ? (
        <Note>Nothing synced yet. What goes between this browser and the device shows up here.</Note>
      ) : (
        <ul className="grid gap-1 overflow-hidden rounded-3xl">
          {entries.map((e) => (
            <li
              key={`${e.at}-${e.text.length}`}
              className="grid gap-1 rounded-md bg-neutral-800 px-4 py-2.5 first:rounded-t-3xl last:rounded-b-3xl"
            >
              <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                {e.to ? (
                  <ClipboardPasteIcon className="size-3.5 shrink-0" />
                ) : (
                  <ClipboardCopyIcon className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 truncate">
                  {e.to ? "To the device" : "From the device"} · {describe(e)}
                </span>
                <span className="ml-auto flex shrink-0 gap-0.5">
                  <EntryButton label="Copy" icon={CopyIcon} onClick={() => void copyEntry(e.text)} />
                  <EntryButton
                    label="Save as a text file"
                    icon={DownloadIcon}
                    onClick={() =>
                      download(new Blob([e.text], { type: "text/plain;charset=utf-8" }), `clipboard-${stamp()}.txt`)
                    }
                  />
                </span>
              </div>
              <p className="line-clamp-3 font-mono text-xs break-all text-neutral-100">{visible(e.text)}</p>
            </li>
          ))}
        </ul>
      )}
      <Note>Spaces show as ·, line breaks as ↵, tabs as →. Kept in this tab only.</Note>
    </section>
  )
}

function EntryButton({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-full text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
      onClick={onClick}
    >
      <Icon className="size-3.5" />
    </button>
  )
}

function preview(text: string) {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}
