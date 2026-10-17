import { CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copyText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    copyText(text).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      },
      () => toast.error("Could not copy to the clipboard"),
    )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" className={cn("shrink-0", className)} onClick={() => void copy()}>
          {copied ? <CheckIcon className="text-emerald-500" /> : <CopyIcon />}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
    </Tooltip>
  )
}

export function CopyBlock({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("bg-muted group flex items-start gap-1 rounded-md py-1.5 pr-1 pl-2.5", className)}>
      <code className="min-w-0 flex-1 py-0.5 font-mono text-xs break-all whitespace-pre-wrap">{text}</code>
      <CopyButton text={text} label="Copy command" />
    </div>
  )
}
