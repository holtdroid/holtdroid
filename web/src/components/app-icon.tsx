import { SmartphoneIcon } from "lucide-react"
import { useState } from "react"
import { iconURL } from "@/api/client"
import { cn } from "@/lib/utils"

export function AppIcon({
  source,
  id,
  hasIcon,
  className,
}: {
  source: string
  id: string
  hasIcon: boolean
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  if (!hasIcon || failed) {
    return (
      <div className={cn("bg-muted text-muted-foreground grid shrink-0 place-items-center rounded-xl", className)}>
        <SmartphoneIcon className="size-1/2" />
      </div>
    )
  }
  return (
    <img
      src={iconURL(source, id)}
      alt=""
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-xl object-contain", className)}
    />
  )
}
