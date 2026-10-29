import { defaults } from "./portal/data"
import type { PortalState, Scenario, Step } from "./types"

export type Phase = "move" | "act" | "done"

export function apply(s: PortalState, step: Step): PortalState {
  const typed = step.type ? { [step.type.key]: step.type.value } : {}
  return { ...s, ...typed, ...step.set }
}

export function stateAt(sc: Scenario, p: { index: number; phase: Phase; typed: number }): PortalState {
  let s: PortalState = { ...defaults, ...sc.initial }
  for (const step of sc.steps.slice(0, p.index)) s = apply(s, step)
  const step = sc.steps[p.index]
  if (!step) return s
  if (p.phase === "done") return apply(s, step)
  if (p.phase === "act" && step.type) return { ...s, [step.type.key]: step.type.value.slice(0, p.typed) }
  return s
}
