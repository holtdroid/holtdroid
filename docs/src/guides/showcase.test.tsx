import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"

Bun.plugin({
  name: "inline-css",
  setup(build) {
    build.onResolve({ filter: /\?(url|inline)$/ }, (args) => ({ path: args.path, namespace: "stub" }))
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'export default ""', loader: "js" }))
  },
})

const features = await import("../components/landing/features")
const { Portal } = await import("./portal")
const { sceneState } = await import("./showcase")
const { guideIds } = await import("./scenarios")

const { hero, recording, bento, more, compare, operateLinks, developerLinks, recordingLinks } = features
const render = (state: Parameters<typeof sceneState>[0]) => renderToStaticMarkup(<Portal s={sceneState(state)} />)

test.each(features.cumulate(hero.frames).map((s, i) => [i, s] as const))("hero frame %d renders", (_, state) => {
  expect(render(state).length).toBeGreaterThan(0)
})

test("the hero ends on the session page", () => {
  expect(render(features.cumulate(hero.frames).at(-1) ?? {})).toContain("/session/")
})

test("the hero has a narrow view for every phase", () => {
  expect(hero.narrow.length).toBe(new Set(hero.frames.map((f) => f.label)).size)
})

test.each(features.cumulate(recording.frames).map((s, i) => [i, s] as const))(
  "recording frame %d renders",
  (_, state) => {
    expect(render(state)).toContain("/recordings/")
  },
)

test.each(bento.filter((t) => t.scene).map((t) => [t.title, t] as const))("%s renders", (_, tile) => {
  expect(render(tile.scene?.state ?? {}).length).toBeGreaterThan(0)
  const [x, y, w, h] = tile.scene?.view ?? [0, 0, 0, 0]
  expect(x >= 0 && y >= 0 && x + w <= 1180 && y + h <= 720).toBe(true)
})

const links = [
  ...bento.map((t) => t.href),
  ...more.map((m) => m.href),
  ...operateLinks.map((l) => l.href),
  ...developerLinks.map((l) => l.href),
  ...Object.values(recordingLinks).map((l) => l.href),
  "/start/installation/",
  "/guides/first-steps/launch-app/",
]

test.each(links.map((l) => [l]))("%s is a docs page", (href) => {
  const base = join(import.meta.dir, "../content/docs", href.replace(/^\/|\/$/g, ""))
  expect(existsSync(`${base}.md`) || existsSync(`${base}.mdx`)).toBe(true)
  const guide = href.match(/^\/guides\/[^/]+\/([^/]+)\/$/)?.[1]
  if (guide) expect(guideIds).toContain(guide)
})

test("the comparison has a row per topic", () => {
  expect(new Set(compare.map((r) => r.topic)).size).toBe(compare.length)
})
