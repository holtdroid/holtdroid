import { useMutation } from "@tanstack/react-query"
import {
  ArrowLeftRightIcon,
  CheckIcon,
  ClipboardCopyIcon,
  ClipboardIcon,
  ClipboardPasteIcon,
  ClipboardXIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { agentClient, type Clipboard, sessionBase, unwrap } from "@/api/client"
import { Button } from "@/components/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { useEventSource } from "@/hooks/use-event-source"
import { type ClipboardSync, setScreenPrefs, useScreenPrefs } from "@/lib/screen-prefs"

const modes: Record<ClipboardSync, { label: string; hint: string; icon: ReactNode }> = {
  both: { label: "Both ways", hint: "Copy on either side, paste on the other", icon: <ArrowLeftRightIcon /> },
  "to-device": { label: "To the device", hint: "What you copy here reaches the device", icon: <ClipboardPasteIcon /> },
  "from-device": {
    label: "From the device",
    hint: "What the device copies lands in your clipboard",
    icon: <ClipboardCopyIcon />,
  },
}

export function ClipboardButton({ provider, id }: { provider: string; id: string }) {
  const { clipboard: on, clipboardSync } = useScreenPrefs()
  const mode = modes[clipboardSync] ? clipboardSync : "both"
  const blocked = useClipboardSync(provider, id, on ? mode : null)

  return (
    <HoverCard openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={on ? "Turn clipboard sync off" : "Turn clipboard sync on"}
          onClick={() => setScreenPrefs({ clipboard: !on })}
        >
          {!on ? <ClipboardXIcon /> : mode === "both" ? <ClipboardIcon /> : modes[mode].icon}
        </Button>
      </HoverCardTrigger>
      <HoverCardContent side="left" align="start" className="flex w-64 flex-col gap-0.5 p-1">
        <div className="grid gap-0.5 px-2 py-1.5">
          <span className="text-sm font-medium">Clipboard sync {on ? "on" : "off"}</span>
          <span className="text-muted-foreground text-xs">
            Click the button to turn it {on ? "off" : "on"}. Ctrl/Cmd+V on the screen always pastes.
          </span>
        </div>
        {(Object.entries(modes) as [ClipboardSync, (typeof modes)[ClipboardSync]][]).map(([m, info]) => (
          <Button
            key={m}
            variant="ghost"
            className="h-auto justify-start gap-2 px-2 py-1.5 text-left"
            onClick={() => setScreenPrefs({ clipboard: true, clipboardSync: m })}
          >
            {info.icon}
            <span className="flex flex-1 flex-col">
              <span>{info.label}</span>
              <span className="text-muted-foreground text-xs font-normal whitespace-normal">{info.hint}</span>
            </span>
            {on && m === mode && <CheckIcon className="text-muted-foreground" />}
          </Button>
        ))}
        {on && blocked && mode !== "from-device" && (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">
            The browser doesn't let the page read your clipboard, so nothing goes to the device on its own.
          </p>
        )}
      </HoverCardContent>
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
