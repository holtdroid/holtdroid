import type { Style } from "@dicebear/core"

let style: Promise<Style> | undefined
const cache = new Map<string, string>()

function loadStyle() {
  style ??= Promise.all([import("@dicebear/core"), import("@dicebear/styles/voxel-art.json")]).then(
    ([core, definition]) => new core.Style(definition.default),
  )
  return style
}

export async function generatedAvatar(seed: string) {
  const hit = cache.get(seed)
  if (hit) return hit
  const { Avatar } = await import("@dicebear/core")
  const uri = new Avatar(await loadStyle(), { seed, size: 96 }).toDataUri()
  cache.set(seed, uri)
  return uri
}

export function cachedAvatar(seed: string) {
  return cache.get(seed)
}
