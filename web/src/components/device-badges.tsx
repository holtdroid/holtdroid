import {
  BugIcon,
  CpuIcon,
  DatabaseIcon,
  type LucideIcon,
  MonitorSmartphoneIcon,
  ShieldIcon,
  SmartphoneIcon,
  TerminalIcon,
} from "lucide-react"
import type { ProviderView } from "@/api/client"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type Slot = ProviderView["capacity"]["slots"][number]

function Item({
  icon: Icon,
  label,
  on = true,
  hint,
}: {
  icon: LucideIcon
  label: string
  on?: boolean
  hint?: string
}) {
  return (
    <Badge
      variant={on ? "secondary" : "outline"}
      title={hint}
      className={cn("gap-1", !on && "text-muted-foreground line-through decoration-1")}
    >
      <Icon />
      {label}
    </Badge>
  )
}

const families = (abis: string[]) => [
  ...new Set(abis.map((a) => (a.startsWith("arm") ? "ARM" : a.startsWith("x86") ? "x86" : a))),
]

export function DeviceBadges({ provider, slot, appABIs }: { provider: ProviderView; slot?: Slot; appABIs?: string[] }) {
  const caps = slot?.capabilities
  const physical = provider.capabilities.kind === "physical"
  const abis = caps?.abis ?? provider.capabilities.abis
  const runs = (family: string) =>
    !appABIs?.length ||
    appABIs.some((a) =>
      family === "ARM" ? a.startsWith("arm") : family === "x86" ? a.startsWith("x86") : a === family,
    )
  const devtools = provider.capabilities.devtools ? (caps?.devtools ?? "all") : null

  return (
    <div className="flex flex-wrap gap-1.5">
      <Item
        icon={physical ? SmartphoneIcon : MonitorSmartphoneIcon}
        label={physical ? "Real device" : provider.capabilities.kind === "emulator" ? "Emulator" : "Simulated"}
      />
      {caps?.model && <Item icon={SmartphoneIcon} label={caps.model} />}
      {caps?.android && <Item icon={SmartphoneIcon} label={`Android ${caps.android}`} />}
      {families(abis).map((f) => (
        <Item
          key={f}
          icon={CpuIcon}
          label={f}
          on={runs(f)}
          hint={runs(f) ? abis.join(", ") : "The APK ships no native code for it"}
        />
      ))}
      <Item icon={TerminalIcon} label="ADB" on={caps?.adb ?? true} />
      <Item
        icon={BugIcon}
        label={devtools === "debuggable" ? "DevTools: debuggable builds" : "DevTools"}
        on={!!devtools}
        hint={devtools === "debuggable" ? "Release builds need root for DevTools" : undefined}
      />
      <Item icon={DatabaseIcon} label="App data" on={caps?.appData ?? true} />
      {caps && <Item icon={ShieldIcon} label="Root" on={caps.root} />}
    </div>
  )
}
