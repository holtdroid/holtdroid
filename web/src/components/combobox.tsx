import { ChevronsUpDownIcon, type LucideIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type ComboboxOption = { value: string; label: string; hint?: string }

export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  icon: Icon,
  disabled,
  className,
}: {
  options: ComboboxOption[]
  value: string
  onChange: (value: string) => void
  placeholder: string
  icon?: LucideIcon
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("justify-between font-normal", className)}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {Icon && <Icon />}
            <span className="truncate">{current?.label ?? (value || placeholder)}</span>
          </span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>Nothing found</CommandEmpty>
            {options.map((o) => (
              <CommandItem
                key={o.value}
                value={`${o.label} ${o.value} ${o.hint ?? ""}`}
                data-checked={o.value === value}
                onSelect={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                <span className="truncate">{o.label}</span>
                {o.hint && <span className="text-muted-foreground ml-auto truncate text-xs">{o.hint}</span>}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
