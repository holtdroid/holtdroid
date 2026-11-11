import { Link, useMatchRoute } from "@tanstack/react-router"
import { BookOpenIcon, EllipsisIcon, MoonIcon, PlusIcon, SearchIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import type { ComponentProps, MouseEvent, ReactNode } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { docsUrl, docsUrlWithReturn } from "@/lib/docs-link"
import { cn } from "@/lib/utils"
import logo from "@/logo.svg"
import { AccountMenu } from "./account-menu"
import { Kbd, modKey } from "./command-palette"
import { DockButton, DockLink, DockSeparator, dockItem } from "./dock-item"
import { type NavItem, useNavItems } from "./nav-items"
import { RunningDevices } from "./running-devices"

function withReturn(e: MouseEvent<HTMLAnchorElement>) {
  e.currentTarget.href = docsUrlWithReturn(window.location.href)
}

function NavLink({ item, active }: { item: NavItem; active?: boolean }) {
  return (
    <DockLink to={item.to} label={item.label} tip={item.tip} active={active}>
      <item.icon />
      {!!item.count && (
        <span className="bg-success text-success-foreground absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-semibold">
          {item.count}
        </span>
      )}
    </DockLink>
  )
}

function MenuLink({
  item,
  current,
  children,
  ...props
}: { item: NavItem; current: boolean; children: ReactNode } & ComponentProps<"a">) {
  return (
    <Link
      {...props}
      to={item.to}
      activeOptions={{ exact: true }}
      aria-current={current ? "page" : undefined}
      className={cn(props.className, current && "bg-accent text-accent-foreground")}
    >
      {children}
    </Link>
  )
}

export function Dock({ onSearch, onLaunch }: { onSearch: () => void; onLaunch: () => void }) {
  const nav = useNavItems()
  const matchRoute = useMatchRoute()
  const onApps = Boolean(matchRoute({ to: "/" }) || matchRoute({ to: "/apps/$pkg", fuzzy: true }))
  const isCurrent = (item: NavItem) => (item.id === "apps" ? onApps : Boolean(matchRoute({ to: item.to, fuzzy: true })))
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  const toggleTheme = () => setTheme(dark ? "light" : "dark")

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center px-3">
      <nav
        aria-label="Main"
        className="bg-card/85 shadow-float pointer-events-auto backdrop-blur-xl backdrop-saturate-150 flex max-w-full items-center gap-1 rounded-[18px] border p-1.5"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Link to="/" aria-label="Holtdroid" className={cn(dockItem, "px-0")}>
              <img src={logo} alt="" className="size-7" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="top">Holtdroid</TooltipContent>
        </Tooltip>
        <DockSeparator />

        <div className="-m-1 flex min-w-0 items-center gap-1 overflow-x-auto p-1 [scrollbar-width:none]">
          <div className="hidden items-center gap-1 md:flex">
            {nav.sections.map((item) => (
              <NavLink key={item.id} item={item} active={item.id === "apps" ? onApps : undefined} />
            ))}
            <DockSeparator />
          </div>

          <RunningDevices />
          <DockButton label="Launch a device" onClick={onLaunch} className="border border-dashed">
            <PlusIcon className="size-4" />
          </DockButton>

          {nav.admin.length > 0 && (
            <div className="hidden items-center gap-1 xl:flex">
              <DockSeparator />
              {nav.admin.map((item) => (
                <NavLink key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
        <DockSeparator />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onSearch}
              aria-label="Search"
              aria-keyshortcuts="Meta+K Control+K"
              className={cn(
                dockItem,
                "xl:bg-card xl:hover:bg-muted xl:w-44 xl:justify-start xl:border xl:px-3 xl:[&_svg:not([class*='size-'])]:size-4",
              )}
            >
              <SearchIcon />
              <span className="hidden xl:inline">Search</span>
              <span className="ml-auto hidden xl:inline">
                <Kbd>{modKey}K</Kbd>
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="xl:hidden">
            Search · {modKey}K
          </TooltipContent>
        </Tooltip>

        <div className="hidden shrink-0 items-center gap-1 xl:flex">
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={docsUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Documentation"
                className={dockItem}
                onClick={withReturn}
                onAuxClick={withReturn}
              >
                <BookOpenIcon />
              </a>
            </TooltipTrigger>
            <TooltipContent side="top">Documentation</TooltipContent>
          </Tooltip>
          <DockButton label="Toggle theme" onClick={toggleTheme}>
            {dark ? <SunIcon /> : <MoonIcon />}
          </DockButton>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="More" className={cn(dockItem, "xl:hidden")}>
              <EllipsisIcon />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" sideOffset={12} align="end" className="w-56">
            {nav.sections.map((item) => (
              <DropdownMenuItem key={item.id} asChild className="md:hidden">
                <MenuLink item={item} current={isCurrent(item)}>
                  <item.icon />
                  {item.label}
                  {!!item.count && <span className="text-success ml-auto text-xs">{item.count}</span>}
                </MenuLink>
              </DropdownMenuItem>
            ))}
            {nav.sections.length > 0 && <DropdownMenuSeparator className="md:hidden" />}
            {nav.admin.map((item) => (
              <DropdownMenuItem key={item.id} asChild>
                <MenuLink item={item} current={isCurrent(item)}>
                  <item.icon />
                  {item.label}
                </MenuLink>
              </DropdownMenuItem>
            ))}
            {nav.admin.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem asChild>
              <a href={docsUrl} target="_blank" rel="noreferrer" onClick={withReturn}>
                <BookOpenIcon />
                Documentation
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleTheme}>
              {dark ? <SunIcon /> : <MoonIcon />}
              {dark ? "Light theme" : "Dark theme"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <AccountMenu />
      </nav>
    </div>
  )
}
