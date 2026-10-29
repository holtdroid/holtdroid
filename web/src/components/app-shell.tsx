import { Link, useMatchRoute } from "@tanstack/react-router"
import {
  BookOpenIcon,
  ClapperboardIcon,
  DatabaseIcon,
  FrameIcon,
  LayoutGridIcon,
  LaptopIcon,
  LogOutIcon,
  MoonIcon,
  ScrollTextIcon,
  ServerIcon,
  ShieldIcon,
  ShuffleIcon,
  SunIcon,
  UserCogIcon,
  UsersIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { type ReactNode, useState } from "react"
import { useAppData, useAuth, useLogout, useRecordings, useReferences, useSessionEvents } from "@/api/queries"
import { useComputers, useSSHInfo } from "@/api/ssh"
import { HeaderSlotProvider } from "@/components/header-slot"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { UserAvatar } from "@/components/user-avatar"
import logo from "@/logo.svg"

export function AppShell({ children }: { children: ReactNode }) {
  useSessionEvents()
  const sshInfo = useSSHInfo()
  const computers = useComputers()
  const online = computers.data?.computers.length ?? 0
  const auth = useAuth()
  const appData = useAppData()
  const references = useReferences()
  const recordings = useRecordings()
  const logout = useLogout()
  const matchRoute = useMatchRoute()
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const onRecording = Boolean(matchRoute({ to: "/recordings/$id" }))
  const slotted =
    onRecording || Boolean(matchRoute({ to: "/session/$provider/$id" }) || matchRoute({ to: "/r/$token" }))
  const onApps = Boolean(matchRoute({ to: "/" }) || matchRoute({ to: "/apps/$pkg", fuzzy: true }))
  const { resolvedTheme, setTheme } = useTheme()
  const identity = auth.data?.identity
  const mode = auth.data?.mode
  const display = identity?.name || identity?.user || ""

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        {slotted ? (
          <div ref={setSlot} className="flex min-w-0 flex-1 items-center" />
        ) : (
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src={logo} alt="" className="size-7" />
            Holtdroid
          </Link>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={onApps ? "bg-muted" : undefined} asChild>
                <Link to="/">
                  <LayoutGridIcon />
                  <span className="sr-only">Apps</span>
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Apps</TooltipContent>
          </Tooltip>
          {appData.data?.enabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <Link to="/app-data" activeProps={{ className: "bg-muted" }}>
                    <DatabaseIcon />
                    <span className="sr-only">App data</span>
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>App data</TooltipContent>
            </Tooltip>
          )}
          {references.data?.enabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <Link to="/pixel-perfect" activeProps={{ className: "bg-muted" }}>
                    <FrameIcon />
                    <span className="sr-only">Pixel perfect</span>
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Pixel perfect: references and Figma</TooltipContent>
            </Tooltip>
          )}
          {recordings.data?.enabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <Link to="/recordings" activeProps={{ className: "bg-muted" }}>
                    <ClapperboardIcon />
                    <span className="sr-only">Recordings</span>
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Recordings</TooltipContent>
            </Tooltip>
          )}
          {sshInfo.data?.enabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" asChild>
                  <Link to="/computers" activeProps={{ className: "bg-muted" }}>
                    <LaptopIcon />
                    {online > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-emerald-500 px-1 text-[10px] leading-none font-semibold text-white tabular-nums">
                        {online}
                      </span>
                    )}
                    <span className="sr-only">Computers</span>
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {online > 0 ? `Computers · ${online} connected` : "Computers: your local ports on the devices"}
              </TooltipContent>
            </Tooltip>
          )}
          {identity?.admin && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <Link to="/inventory" activeProps={{ className: "bg-muted" }}>
                    <ServerIcon />
                    <span className="sr-only">Inventory</span>
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Inventory</TooltipContent>
            </Tooltip>
          )}
          {identity?.admin && mode === "users" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <Link to="/users" activeProps={{ className: "bg-muted" }}>
                    <UsersIcon />
                    <span className="sr-only">Users</span>
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Users</TooltipContent>
            </Tooltip>
          )}
          {identity?.admin && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <Link to="/audit" activeProps={{ className: "bg-muted" }}>
                    <ScrollTextIcon />
                    <span className="sr-only">Audit log</span>
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Audit log</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" asChild>
                <a href="https://holtdroid.github.io/" target="_blank" rel="noreferrer">
                  <BookOpenIcon />
                  <span className="sr-only">Documentation</span>
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Documentation</TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
          </Button>
          {identity && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="ml-1 h-9 gap-2 px-1.5">
                  <UserAvatar user={identity.user} picture={identity.picture} className="size-7" />
                  <span className="hidden max-w-40 truncate text-sm sm:inline">{display}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="grid gap-0.5">
                  <span className="truncate">{display}</span>
                  {identity.email && (
                    <span className="text-muted-foreground truncate text-xs font-normal">{identity.email}</span>
                  )}
                  {identity.admin && (
                    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-normal">
                      <ShieldIcon className="size-3" /> admin
                    </span>
                  )}
                </DropdownMenuLabel>
                {mode === "users" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/account">
                        <UserCogIcon />
                        Account and passkeys
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
                {(mode === "anonymous" || mode === "password" || mode === "oidc" || mode === "users") && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => logout.mutate()}>
                      {mode === "anonymous" ? <ShuffleIcon /> : <LogOutIcon />}
                      {mode === "anonymous" ? "Get a new name" : "Sign out"}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        <HeaderSlotProvider value={slotted ? slot : null}>{children}</HeaderSlotProvider>
      </main>
    </div>
  )
}
