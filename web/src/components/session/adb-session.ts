import { useQuery } from "@tanstack/react-query"
import type { Adb } from "@yume-chan/adb"
import { useEffect, useState, useSyncExternalStore } from "react"
import { api, sessionBase, unwrap } from "@/api/client"
import { adbURL, connectAdb } from "@/lib/adb"
import { LogcatStore } from "@/lib/logcat"

export type AdbStatus =
  | { state: "idle" | "connecting" }
  | { state: "ready"; adb: Adb }
  | { state: "error"; error: string }

// AdbSession is the session page's one ADB connection, shared by the
// logcat, files, terminal and app tools.
export class AdbSession {
  #status: AdbStatus = { state: "idle" }
  #generation = 0
  #pkg = ""
  readonly #listeners = new Set<() => void>()
  readonly logcat = new LogcatStore()

  constructor(readonly base: string) {}

  get status() {
    return this.#status
  }

  subscribe = (l: () => void) => {
    this.#listeners.add(l)
    return () => this.#listeners.delete(l)
  }

  #set(status: AdbStatus) {
    this.#status = status
    for (const l of this.#listeners) l()
  }

  reopen() {
    return this.open(this.#pkg)
  }

  async open(pkg: string) {
    this.#pkg = pkg
    const generation = ++this.#generation
    this.#set({ state: "connecting" })
    try {
      const adb = await connectAdb(adbURL(this.base))
      if (generation !== this.#generation) {
        await adb.close()
        return
      }
      this.#set({ state: "ready", adb })
      void this.logcat.start(adb, pkg).catch(() => undefined)
      void adb.disconnected.then(() => {
        if (generation !== this.#generation) return
        this.logcat.stop()
        this.#set({ state: "error", error: "The ADB connection closed" })
      })
    } catch (e) {
      if (generation === this.#generation) {
        this.#set({ state: "error", error: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  close() {
    this.#generation++
    this.logcat.stop()
    if (this.#status.state === "ready") void this.#status.adb.close()
    this.#set({ state: "idle" })
  }
}

export function useADBInfo() {
  return useQuery({ queryKey: ["adb-info"], queryFn: () => unwrap(api.GET("/api/v1/adb")), staleTime: Infinity })
}

// useAdbSession connects once the device is first ready and keeps the
// connection, and the logcat it collects, while the app restarts.
export function useAdbSession(provider: string, id: string, pkg: string, enabled: boolean) {
  const [session] = useState(() => new AdbSession(sessionBase(provider, id)))
  useEffect(() => {
    if (!enabled) return undefined
    void session.open(pkg)
    return () => session.close()
  }, [session, enabled, pkg])
  return session
}

export function useAdbStatus(session: AdbSession) {
  return useSyncExternalStore(session.subscribe, () => session.status)
}

export function useAdb(session: AdbSession) {
  const status = useAdbStatus(session)
  return status.state === "ready" ? status.adb : undefined
}
