import { type ReactNode, useCallback, useState } from "react"
import { useSessionEvents } from "@/api/queries"
import { CommandPalette, type PaletteMode, usePaletteShortcut } from "@/components/dock/command-palette"
import { Dock } from "@/components/dock/dock"
import { InShellProvider } from "@/components/shell-context"

export function AppShell({ children }: { children: ReactNode }) {
  useSessionEvents()
  const [palette, setPalette] = useState<{ open: boolean; mode: PaletteMode }>({ open: false, mode: "all" })
  const toggle = useCallback(() => setPalette((p) => ({ open: !p.open, mode: "all" })), [])
  usePaletteShortcut(toggle)

  return (
    <div className="flex h-dvh flex-col">
      <main className="min-h-0 flex-1 overflow-hidden pb-20">
        <InShellProvider value={true}>{children}</InShellProvider>
      </main>
      <Dock
        onSearch={() => setPalette({ open: true, mode: "all" })}
        onLaunch={() => setPalette({ open: true, mode: "launch" })}
      />
      <CommandPalette
        open={palette.open}
        mode={palette.mode}
        onOpenChange={(open) => setPalette((p) => ({ ...p, open }))}
      />
    </div>
  )
}
