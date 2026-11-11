import { useNavigate } from "@tanstack/react-router"
import { Command as CommandPrimitive } from "cmdk"
import {
  BookOpenIcon,
  ClapperboardIcon,
  CornerDownLeftIcon,
  MoonIcon,
  PlayIcon,
  SearchIcon,
  SquareIcon,
  SunIcon,
  UploadIcon,
  UserCogIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { type ReactNode, useEffect, useMemo } from "react"
import type { ArtifactView } from "@/api/client"
import { canManage, useArtifacts, useAuth, useMe, useRecordings, useStopSession, useUploads } from "@/api/queries"
import { AppIcon } from "@/components/app-icon"
import { appTitle } from "@/components/artifact-list"
import { recordingName } from "@/components/recording/rename-button"
import { SessionStateBadge } from "@/components/session-state-badge"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { openDocs } from "@/lib/docs-link"
import { formatDuration } from "@/lib/format"
import { useNavItems } from "./nav-items"
import { deviceLine, useMySessions } from "./running-devices"

export type PaletteMode = "all" | "launch"

export const modKey = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl "

export function usePaletteShortcut(onToggle: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === "KeyK") {
        e.preventDefault()
        onToggle()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onToggle])
}

export function newestPerApp(items: ArtifactView[]) {
  const apps = new Map<string, ArtifactView>()
  for (const a of items) {
    const key = a.app?.package ?? `${a.source}/${a.id}`
    const seen = apps.get(key)
    if (!seen || (a.app?.versionCode ?? 0) > (seen.app?.versionCode ?? 0)) apps.set(key, a)
  }
  return [...apps.values()]
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <span className="bg-muted text-muted-foreground grid size-[30px] shrink-0 place-items-center rounded-[9px] border [&_svg]:size-3.5">
      {children}
    </span>
  )
}

const item =
  "h-11 gap-3 rounded-[10px]! px-3 text-sm data-selected:shadow-[inset_0_0_0_1px_var(--border)] [&>svg:last-child]:hidden"

const group =
  "p-0 **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:pt-2.5 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:tracking-[.06em] **:[[cmdk-group-heading]]:uppercase"

function PaletteBody({ mode, close }: { mode: PaletteMode; close: () => void }) {
  const navigate = useNavigate()
  const auth = useAuth()
  const nav = useNavItems()
  const mine = useMySessions()
  const me = useMe()
  const stop = useStopSession()
  const artifacts = useArtifacts("")
  const recordings = useRecordings()
  const uploads = useUploads()
  const { resolvedTheme, setTheme } = useTheme()
  const apps = useMemo(() => newestPerApp(artifacts.data?.items ?? []), [artifacts.data])
  const launchOnly = mode === "launch"

  const run = (fn: () => void) => () => {
    close()
    fn()
  }

  return (
    <>
      {!launchOnly && mine.length > 0 && (
        <CommandGroup heading="Running devices" className={group}>
          {mine.map((s) => (
            <CommandItem
              key={`${s.provider}/${s.id}`}
              value={`device ${s.provider}/${s.id} ${s.label ?? ""} ${s.package} ${deviceLine(s)}`}
              className={item}
              onSelect={run(
                () => void navigate({ to: "/session/$provider/$id", params: { provider: s.provider, id: s.id } }),
              )}
            >
              <AppIcon src={s.iconUrl} className="size-7 rounded-lg" />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{s.label || s.package}</span>
                <span className="text-muted-foreground"> · {deviceLine(s)}</span>
              </span>
              <SessionStateBadge state={s.state} />
              <CornerDownLeftIcon className="text-muted-foreground" />
            </CommandItem>
          ))}
          {mine
            .filter((s) => canManage(me.data, s))
            .map((s) => (
              <CommandItem
                key={`stop ${s.provider}/${s.id}`}
                value={`stop device ${s.provider}/${s.id} ${s.label ?? ""} ${s.package}`}
                className={item}
                onSelect={run(
                  () =>
                    void stop
                      .mutateAsync(s)
                      .catch((e: Error) => toast.error("Could not stop", { description: e.message })),
                )}
              >
                <Icon>
                  <SquareIcon />
                </Icon>
                <span className="min-w-0 flex-1 truncate">Stop {s.label || s.package}</span>
              </CommandItem>
            ))}
        </CommandGroup>
      )}
      <CommandGroup heading={launchOnly ? "Launch an app" : "Apps"} className={group}>
        {apps.map((a) => (
          <CommandItem
            key={`${a.source}/${a.id}`}
            value={`app ${a.source}/${a.id} ${appTitle(a)} ${a.app?.package ?? a.fileName} ${a.app?.versionName ?? ""}`}
            className={item}
            onSelect={run(() => void navigate({ to: "/", search: { source: a.source, launch: a.id } }))}
          >
            <AppIcon src={a.iconUrl} className="size-7 rounded-lg" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{appTitle(a)}</span>
              {a.app?.versionName && (
                <span className="text-muted-foreground ml-1.5 font-mono text-xs">{a.app.versionName}</span>
              )}
            </span>
            <span className="text-muted-foreground text-xs">Launch</span>
            <PlayIcon className="text-muted-foreground size-3.5!" />
          </CommandItem>
        ))}
      </CommandGroup>
      {!launchOnly && recordings.data?.enabled && (recordings.data.items.length ?? 0) > 0 && (
        <CommandGroup heading="Recordings" className={group}>
          {recordings.data.items.slice(0, 50).map((r) => (
            <CommandItem
              key={r.id}
              value={`recording ${r.id} ${recordingName(r)} ${r.package} ${r.versionName ?? ""}`}
              className={item}
              onSelect={run(() => void navigate({ to: "/recordings/$id", params: { id: r.id } }))}
            >
              <Icon>
                <ClapperboardIcon />
              </Icon>
              <span className="min-w-0 flex-1 truncate">
                {recordingName(r)}
                <span className="text-muted-foreground">
                  {r.versionName ? ` · ${r.versionName}` : ""} · {formatDuration(r.duration)}
                </span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {!launchOnly && (
        <CommandGroup heading="Pages" className={group}>
          {[...nav.sections, ...nav.admin].map((p) => (
            <CommandItem
              key={p.id}
              value={`page ${p.label}`}
              className={item}
              onSelect={run(() => void navigate({ to: p.to }))}
            >
              <Icon>
                <p.icon />
              </Icon>
              <span className="flex-1">{p.label}</span>
              {nav.admin.includes(p) && <span className="text-muted-foreground text-xs">Admin</span>}
            </CommandItem>
          ))}
          {auth.data?.mode === "users" && (
            <CommandItem
              value="page Account and passkeys"
              className={item}
              onSelect={run(() => void navigate({ to: "/account" }))}
            >
              <Icon>
                <UserCogIcon />
              </Icon>
              <span className="flex-1">Account and passkeys</span>
            </CommandItem>
          )}
        </CommandGroup>
      )}
      {!launchOnly && (
        <CommandGroup heading="Actions" className={group}>
          {uploads.data?.enabled && (
            <CommandItem
              value="action Upload an APK"
              className={item}
              onSelect={run(() => void navigate({ to: "/", search: { upload: true } }))}
            >
              <Icon>
                <UploadIcon />
              </Icon>
              <span className="flex-1">Upload an APK</span>
            </CommandItem>
          )}
          <CommandItem
            value="action Switch theme dark light"
            className={item}
            onSelect={run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}
          >
            <Icon>{resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}</Icon>
            <span className="flex-1">Switch to {resolvedTheme === "dark" ? "light" : "dark"} theme</span>
          </CommandItem>
          <CommandItem value="action Documentation docs help" className={item} onSelect={run(openDocs)}>
            <Icon>
              <BookOpenIcon />
            </Icon>
            <span className="flex-1">Documentation</span>
          </CommandItem>
        </CommandGroup>
      )}
    </>
  )
}

export function CommandPalette({
  open,
  mode,
  onOpenChange,
}: {
  open: boolean
  mode: PaletteMode
  onOpenChange: (open: boolean) => void
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "launch" ? "Launch an app" : "Search the portal"}
      description="Search apps, devices, recordings and pages"
      className="top-[12vh] gap-0 rounded-2xl! sm:max-w-[640px]"
    >
      <Command className="rounded-none! p-0" loop>
        <div className="flex h-14 items-center gap-3 border-b px-4">
          <SearchIcon className="text-muted-foreground size-5 shrink-0" />
          <CommandPrimitive.Input
            placeholder={mode === "launch" ? "Launch an app…" : "Search apps, devices, recordings and pages"}
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[17px] outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <CommandList className="max-h-[min(60vh,520px)] p-2">
          <CommandEmpty className="text-muted-foreground py-8">Nothing matches.</CommandEmpty>
          <PaletteBody mode={mode} close={() => onOpenChange(false)} />
        </CommandList>
        <div className="text-muted-foreground flex items-center gap-4 border-t px-4 py-2.5 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            open
          </span>
          <span className="ml-auto">{modKey}K anywhere in the portal</span>
        </div>
      </Command>
    </CommandDialog>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="text-muted-foreground rounded-[5px] border px-[5px] py-px font-sans text-[11px] font-medium">
      {children}
    </kbd>
  )
}
