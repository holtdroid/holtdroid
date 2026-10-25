import { useMutation } from "@tanstack/react-query"
import {
  ArrowLeftRightIcon,
  ClipboardCheckIcon,
  ClipboardCopyIcon,
  ClipboardIcon,
  ClipboardPasteIcon,
  ClipboardXIcon,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { agentClient, type Clipboard, sessionBase, unwrap } from "@/api/client"
import { CardLine, Note, Row, Section, ShadeCard, ShadeHeader, ShadePanel, Tile } from "@/components/session/shade"
import { HoverCard, HoverCardTrigger } from "@/components/ui/hover-card"
import { useEventSource } from "@/hooks/use-event-source"
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
  const blocked = useClipboardSync(provider, id, on ? mode : null)
  const summary = on ? modes[mode].label : "Off"

  return (
    <HoverCard openDelay={150} closeDelay={200}>
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
      </ShadePanel>
    </HoverCard>
  )
}

function useClipboardSync(provider: string, id: string, mode: ClipboardSync | null) {
  const client = useMemo(() => agentClient(provider, id), [provider, id])
  const last = useRef<string | null>(null)
  const pending = useRef<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const toDevice = mode === "both" || mode === "to-device"
  const fromDevice = mode === "both" || mode === "from-device"

  const send = useMutation({
    mutationFn: (text: string) => unwrap(client.POST("/v1/clipboard", { body: { text } })),
    onSuccess: (_, text) => toast("Sent to the device clipboard", { id: "clipboard", description: preview(text) }),
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

  return blocked
}

function preview(text: string) {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}
