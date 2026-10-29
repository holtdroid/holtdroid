type Build = {
  source: string
  id: string
  meta: { title?: string }
  app?: { package: string; versionName?: string; abis: string[] }
}

export function abiRank(build: Build, device: string[] | undefined) {
  const abis = build.app?.abis ?? []
  if (!device?.length || abis.length === 0) return 0
  const ranks = abis.map((abi) => device.indexOf(abi)).filter((i) => i >= 0)
  return ranks.length > 0 ? Math.min(...ranks) : Infinity
}

const family = (abi: string) => (abi.startsWith("x86") ? "x86" : abi.startsWith("arm") ? "arm" : abi)

// native: the build has code for the device's own processor family, not
// only for one it translates (ARM on x86).
export function native(build: Build, device: string[] | undefined) {
  return runsNatively(build.app?.abis ?? [], device)
}

export function runsNatively(abis: string[], device: string[] | undefined) {
  const own = device?.[0]
  if (!own || abis.length === 0) return true
  return abis.some((abi) => device.includes(abi) && family(abi) === family(own))
}

const disjoint = (a: string[], b: string[]) => a.length > 0 && b.length > 0 && !a.some((abi) => b.includes(abi))

// groupVariants puts builds of one version that differ only in their ABIs
// together: same source, package and title (or version name).
export function groupVariants<T extends Build>(builds: T[]): T[][] {
  const groups: T[][] = []
  const byKey = new Map<string, T[][]>()
  for (const b of builds) {
    const key = b.app && `${b.source}\n${b.app.package}\n${b.meta.title || b.app.versionName || ""}`
    const same = key ? (byKey.get(key) ?? []) : []
    const group = same.find((g) => g.every((o) => disjoint(o.app?.abis ?? [], b.app?.abis ?? [])))
    if (group) {
      group.push(b)
      continue
    }
    groups.push([b])
    if (key) byKey.set(key, [...same, groups.at(-1)!])
  }
  return groups
}

export function variantsOf<T extends Build>(builds: T[], build: T): T[] {
  const group = groupVariants(builds).find((g) => g.some((b) => b.source === build.source && b.id === build.id))
  return group ?? [build]
}

// bestVariant takes the variant whose ABI the device prefers. A build that
// needs translation only counts when no build among siblings (the app's other
// builds) runs natively: that one is a build for another kind of device.
export function bestVariant<T extends Build>(
  variants: T[],
  device: string[] | undefined,
  siblings: T[] = variants,
): T | undefined {
  const nativeExists = siblings.some((b) => (b.app?.abis.length ?? 0) > 0 && native(b, device))
  let best: T | undefined
  let rank = Infinity
  for (const v of variants) {
    if (nativeExists && !native(v, device)) continue
    const r = abiRank(v, device)
    if (r < rank) [best, rank] = [v, r]
  }
  return best
}
