import type { SessionView } from "@/api/client"

export type SessionTone = "ready" | "starting" | "idle" | "failed" | "stopping"

export const idleWarning = 5 * 60_000

export function stopsIn(s: Pick<SessionView, "idleDeadline" | "ttlDeadline">, now: number) {
  return Math.min(new Date(s.idleDeadline).getTime(), new Date(s.ttlDeadline).getTime()) - now
}

export function sessionTone(s: Pick<SessionView, "state" | "idleDeadline" | "ttlDeadline">, now: number): SessionTone {
  switch (s.state) {
    case "failed":
      return "failed"
    case "stopping":
      return "stopping"
    case "ready":
      return stopsIn(s, now) <= idleWarning ? "idle" : "ready"
    default:
      return "starting"
  }
}

export const toneDot: Record<SessionTone, string> = {
  ready: "bg-success",
  starting: "bg-info animate-pulse",
  idle: "bg-warning",
  failed: "bg-danger",
  stopping: "bg-muted-foreground",
}
