import { useEffect, useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cachedAvatar, generatedAvatar } from "@/lib/generated-avatar"
import { cn } from "@/lib/utils"

function initials(name: string) {
  const parts = name.split(/[\s\-_.@]+/).filter(Boolean)
  return (parts.length > 1 ? parts.slice(-2).map((p) => p[0]) : [name.slice(0, 2)]).join("").toUpperCase()
}

function useGeneratedAvatar(seed: string) {
  const [loaded, setLoaded] = useState<{ seed: string; uri: string } | null>(null)
  useEffect(() => {
    let alive = true
    void generatedAvatar(seed).then((uri) => alive && setLoaded({ seed, uri }))
    return () => {
      alive = false
    }
  }, [seed])
  return cachedAvatar(seed) ?? (loaded?.seed === seed ? loaded.uri : undefined)
}

export function UserAvatar({
  user,
  picture,
  className,
  tooltip,
}: {
  user: string
  picture?: string
  className?: string
  tooltip?: boolean
}) {
  const generated = useGeneratedAvatar(user)
  const avatar = (
    <Avatar className={cn("size-8", className)}>
      {picture && <AvatarImage src={picture} alt="" referrerPolicy="no-referrer" />}
      {generated ? (
        <AvatarFallback className="bg-transparent p-0" delayMs={picture ? 400 : 0}>
          <img src={generated} alt="" className="size-full" />
        </AvatarFallback>
      ) : (
        <AvatarFallback className="text-[10px]">{initials(user)}</AvatarFallback>
      )}
    </Avatar>
  )
  if (!tooltip) return avatar
  return (
    <Tooltip>
      <TooltipTrigger asChild>{avatar}</TooltipTrigger>
      <TooltipContent>{user}</TooltipContent>
    </Tooltip>
  )
}
