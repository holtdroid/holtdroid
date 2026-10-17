import type { ComponentProps, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useScreenPrefs } from "@/lib/screen-prefs"
import { cn } from "@/lib/utils"

export function RailItem({
  label,
  text,
  children,
  className,
  ...props
}: { label: string; text?: string; children: ReactNode } & ComponentProps<typeof Button>) {
  const { railLabels } = useScreenPrefs()
  return (
    <Button
      size={railLabels ? "sm" : "icon-sm"}
      variant="ghost"
      aria-label={label}
      className={cn("relative", railLabels && "w-full justify-start gap-2 px-2 font-normal", className)}
      {...props}
    >
      {children}
      {railLabels && <span className="min-w-0 truncate">{text ?? label}</span>}
    </Button>
  )
}

export function RailButton({
  label,
  text,
  ...props
}: { label: string; text?: string; children: ReactNode } & ComponentProps<typeof Button>) {
  const { railLabels } = useScreenPrefs()
  if (railLabels && (text === undefined || text === label)) return <RailItem label={label} {...props} />
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <RailItem label={label} text={text} {...props} />
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-64">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function RailSection({ title, separator = true }: { title: string; separator?: boolean }) {
  const { railLabels } = useScreenPrefs()
  if (!railLabels) return separator ? <Separator className="my-1 w-6!" /> : null
  return (
    <span className="text-muted-foreground px-2 pt-2 pb-0.5 text-[11px] font-medium tracking-wide uppercase">
      {title}
    </span>
  )
}
