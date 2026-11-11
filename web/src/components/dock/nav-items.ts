import type { LinkProps } from "@tanstack/react-router"
import {
  ClapperboardIcon,
  DatabaseIcon,
  FrameIcon,
  LaptopIcon,
  LayoutGridIcon,
  type LucideIcon,
  ScrollTextIcon,
  ServerIcon,
  UsersIcon,
} from "lucide-react"
import { useAppData, useAuth, useRecordings, useReferences } from "@/api/queries"
import { useComputers, useSSHInfo } from "@/api/ssh"

export type NavItem = {
  id: string
  to: LinkProps["to"]
  label: string
  tip?: string
  icon: LucideIcon
  count?: number
}

export function useNavItems() {
  const auth = useAuth()
  const appData = useAppData()
  const references = useReferences()
  const recordings = useRecordings()
  const sshInfo = useSSHInfo()
  const computers = useComputers()
  const online = computers.data?.computers.length ?? 0
  const admin = !!auth.data?.identity?.admin
  const mode = auth.data?.mode

  const sections: NavItem[] = [{ id: "apps", to: "/", label: "Apps", icon: LayoutGridIcon }]
  if (appData.data?.enabled) sections.push({ id: "app-data", to: "/app-data", label: "App data", icon: DatabaseIcon })
  if (references.data?.enabled)
    sections.push({
      id: "pixel-perfect",
      to: "/pixel-perfect",
      label: "Pixel perfect",
      tip: "Pixel perfect: references and Figma",
      icon: FrameIcon,
    })
  if (recordings.data?.enabled)
    sections.push({ id: "recordings", to: "/recordings", label: "Recordings", icon: ClapperboardIcon })
  if (sshInfo.data?.enabled)
    sections.push({
      id: "computers",
      to: "/computers",
      label: "Computers",
      tip: online > 0 ? `Computers · ${online} connected` : "Computers: your local ports on the devices",
      icon: LaptopIcon,
      count: online,
    })

  const adminItems: NavItem[] = []
  if (admin) {
    adminItems.push({ id: "inventory", to: "/inventory", label: "Inventory", icon: ServerIcon })
    if (mode === "users") adminItems.push({ id: "users", to: "/users", label: "Users", icon: UsersIcon })
    adminItems.push({ id: "audit", to: "/audit", label: "Audit log", icon: ScrollTextIcon })
  }

  return { sections, admin: adminItems }
}
