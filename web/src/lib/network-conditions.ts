import type { DeviceState, NetworkLink, NetworkProfileInfo, NetworkRegionInfo, NetworkRoute } from "@/api/client"
import { countryFlag } from "@/lib/format"

export type NetworkStep = NonNullable<NetworkProfileInfo["steps"]>[number]

export function summary(s: DeviceState, info?: NetworkRegionInfo) {
  const profile = s.networkProfiles?.find((p) => p.id === s.networkProfile)
  const link = profile && profile.id !== "full" ? profile.name : info ? "typical mobile" : "No emulation"
  return info ? `${countryFlag(info.country)} ${info.name} · ${link}` : link
}

export function emulating(s: DeviceState) {
  return (!!s.networkProfile && s.networkProfile !== "full") || !!s.networkRegion
}

export function bandwidth(kbit?: number) {
  if (!kbit) return "∞"
  return kbit >= 1000 ? `${kbit / 1000} Mbit/s` : `${kbit} kbit/s`
}

export function mbit(kbit?: number) {
  if (!kbit) return "∞"
  const v = kbit / 1000
  return v >= 10 ? `${Math.round(v)}` : `${Math.round(v * 10) / 10}`
}

export function linkNumbers(p: NetworkLink | NetworkProfileInfo) {
  return [
    p.rtt && `+${p.rtt}${p.jitter ? ` ±${p.jitter}` : ""} ms`,
    (p.down || p.up) && `↓ ${bandwidth(p.down)} ↑ ${bandwidth(p.up)}`,
    p.loss && `${p.loss}% loss`,
  ]
    .filter(Boolean)
    .join(" · ")
}

export function regionIssues(r: NetworkRegionInfo, route: NetworkRoute | undefined, server: string) {
  if (!route) return []
  const mine = route.servers?.find((x) => x.server === server)?.rtt
  const theirs = r.servers.find((x) => x.server === server)?.rtt
  return [
    !!route.edge && route.edge > r.edgeRtt && "CDN",
    !!mine && !!theirs && mine > theirs && "servers",
    !!route.down && !!r.access.down && r.access.down > route.down && "bandwidth",
  ].filter((x) => typeof x === "string")
}

export function profileNotes(link: NetworkLink | NetworkProfileInfo, route: NetworkRoute | undefined, delay: boolean) {
  if (!route) return []
  return [
    delay &&
      !!route.edge &&
      !!link.rtt &&
      route.edge > link.rtt &&
      `The VPN route's ${route.edge} ms is more than this network's own ${link.rtt} ms`,
    !!route.down && !!link.down && link.down > route.down && `Capped at about ${bandwidth(route.down)} by the VPN`,
  ].filter((x) => typeof x === "string")
}

const slowest = Math.log10(25)
const fastest = Math.log10(150_000)

export type Quality = "good" | "fair" | "poor" | "outage"

/** speed rates a link from 0 (GPRS) to 1 (5G or unlimited) on a log scale of its download, less for loss and delay. */
export function speed(p: { down?: number; rtt?: number; loss?: number }) {
  const down = p.down ? (Math.log10(p.down) - slowest) / (fastest - slowest) : 1
  const delay = Math.min((p.rtt ?? 0) / 1000, 1) * 0.35
  const loss = Math.min((p.loss ?? 0) / 10, 1) * 0.35
  return Math.max(0.03, Math.min(1, down - delay - loss))
}

export function quality(score: number): Quality {
  return score >= 0.6 ? "good" : score >= 0.35 ? "fair" : "poor"
}

export const qualityFill: Record<Quality, string> = {
  good: "bg-success",
  fair: "bg-warning",
  poor: "bg-danger",
  outage: "bg-danger",
}

export function stepLink(profiles: NetworkProfileInfo[], step: NetworkStep) {
  return step.profile ? profiles.find((p) => p.id === step.profile) : undefined
}

export function stepName(profiles: NetworkProfileInfo[], step: NetworkStep, own?: NetworkProfileInfo) {
  if (!step.profile) return "Outage"
  if (own && step.profile === own.id) return own.rtt ? `${own.rtt} ms · ${mbit(own.down)} M` : own.name
  return stepLink(profiles, step)?.name ?? step.profile
}

export function seconds(ms: number) {
  return String(Math.round(ms / 100) / 10)
}

export function hold(step: NetworkStep) {
  return step.min === step.max ? `${seconds(step.min)} s` : `${seconds(step.min)}–${seconds(step.max)} s`
}

export function loop(steps: NetworkStep[]) {
  const min = steps.reduce((t, s) => t + s.min, 0)
  const max = steps.reduce((t, s) => t + s.max, 0)
  return {
    min,
    max,
    mean: (min + max) / 2,
    text: min === max ? `${seconds(min)} s` : `${seconds(min)}–${seconds(max)} s`,
  }
}

export type Position = { step: number; count: number; elapsed: number; progress: number; next: number }

/** devicePoll is how long until the device state is worth reading again: soon while a GPS route moves or a scenario step may end. */
export function devicePoll(s: DeviceState | undefined, now: number) {
  if (s?.route?.moving) return 1_000
  const profile = s?.networkProfiles?.find((p) => p.id === s.networkProfile)
  const step = s?.networkStep !== undefined ? profile?.steps?.[s.networkStep] : undefined
  if (!step || !s?.networkStepSince) return 30_000
  return Math.min(30_000, Math.max(2_000, Date.parse(s.networkStepSince) + step.min - now))
}

/** position is where a running scenario is: its step, how long it has held and how far into the step's longest hold. */
export function position(s: DeviceState, now: number): Position | null {
  const profile = s.networkProfiles?.find((p) => p.id === s.networkProfile)
  const steps = profile?.steps
  if (!steps?.length || s.networkStep === undefined || s.networkStep >= steps.length) return null
  const step = steps[s.networkStep]
  if (!step) return null
  const since = s.networkStepSince ? Date.parse(s.networkStepSince) : now
  const elapsed = Math.max(0, now - since)
  return {
    step: s.networkStep,
    count: steps.length,
    elapsed,
    progress: step.max > 0 ? Math.min(1, elapsed / step.max) : 1,
    next: (s.networkStep + 1) % steps.length,
  }
}
