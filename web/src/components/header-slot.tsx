import { createContext, type ReactNode, useContext } from "react"
import { createPortal } from "react-dom"

const Slot = createContext<HTMLElement | null>(null)

export const HeaderSlotProvider = Slot.Provider

/** Whether the page sits in the portal's shell, which has a header slot for it. */
export function useInShell() {
  return useContext(Slot) !== null
}

/** Puts its children in the portal's header, in place of the logo, while the page is open. */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const el = useContext(Slot)
  return el ? createPortal(children, el) : null
}
