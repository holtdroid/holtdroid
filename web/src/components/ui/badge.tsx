import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-[7px] py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "border-border bg-muted text-muted-foreground [a]:hover:bg-accent",
        destructive:
          "bg-danger-soft text-danger focus-visible:ring-danger/20 [a]:hover:bg-danger-soft/80",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        success: "bg-success-soft text-success [a]:hover:bg-success-soft/80",
        info: "bg-info-soft text-info [a]:hover:bg-info-soft/80",
        warning: "bg-warning-soft text-warning [a]:hover:bg-warning-soft/80",
        violet: "bg-violet-soft text-violet [a]:hover:bg-violet-soft/80",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  dot = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean; dot?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {dot && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Badge, badgeVariants }
