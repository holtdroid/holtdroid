import { SmartphoneIcon } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

export function AppIcon({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState<string>()
  if (!src || failed === src) {
    return (
      <div className={cn("bg-muted text-muted-foreground grid shrink-0 place-items-center rounded-xl", className)}>
        <SmartphoneIcon className="size-1/2" />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(src)}
      className={cn("shrink-0 rounded-xl object-contain", className)}
    />
  )
}
