import type { SessionView } from "@/api/client"

export type Countdown = { ms: number; idle: boolean; segments: number }

/** countdown is the time until the session stops, whether the idle timeout or the lifetime ends it first, and how many of five segments of that span remain. */
export function countdown(
  s: Pick<SessionView, "idleDeadline" | "ttlDeadline" | "lastActivity" | "createdAt">,
  now: number,
): Countdown {
  const idleAt = Date.parse(s.idleDeadline)
  const ttlAt = Date.parse(s.ttlDeadline)
  const idle = idleAt <= ttlAt
  const end = idle ? idleAt : ttlAt
  const start = Date.parse(idle ? s.lastActivity : s.createdAt)
  const ms = Math.max(0, end - now)
  const span = end - start
  const segments = span > 0 ? Math.min(5, Math.max(0, Math.ceil((ms / span) * 5))) : ms > 0 ? 5 : 0
  return { ms, idle, segments }
}
