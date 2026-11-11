import { createContext, useContext } from "react"

const InShell = createContext(false)

export const InShellProvider = InShell.Provider

export function useInShell() {
  return useContext(InShell)
}
