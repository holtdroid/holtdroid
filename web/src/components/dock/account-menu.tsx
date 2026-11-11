import { Link } from "@tanstack/react-router"
import { LogOutIcon, ShieldIcon, ShuffleIcon, UserCogIcon } from "lucide-react"
import { useAuth, useLogout } from "@/api/queries"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { UserAvatar } from "@/components/user-avatar"
import { cn } from "@/lib/utils"
import { dockItem } from "./dock-item"

export function AccountMenu() {
  const auth = useAuth()
  const logout = useLogout()
  const identity = auth.data?.identity
  const mode = auth.data?.mode
  if (!identity) return null
  const display = identity.name || identity.user

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Account: ${display}`} className={cn(dockItem, "px-1.5")}>
          <UserAvatar user={identity.user} picture={identity.picture} className="size-7" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" sideOffset={12} align="end" className="w-56">
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
  )
}
