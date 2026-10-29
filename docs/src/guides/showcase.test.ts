import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

Bun.plugin({
  name: "inline-css",
  setup(build) {
    build.onResolve({ filter: /\?(url|inline)$/ }, (args) => ({ path: args.path, namespace: "stub" }))
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'export default ""', loader: "js" }))
  },
})

const { scenes } = await import("./showcase")
const { guideIds } = await import("./scenarios")

test.each(scenes.map((s) => [s.guide, s] as const))("%s is a guide with a page", (guide, scene) => {
  expect(guideIds).toContain(guide)
  const page = scene.href.replace(/^\/holtdroid\//, "").replace(/\/$/, ".mdx")
  expect(existsSync(join(import.meta.dir, "../content/docs", page))).toBe(true)
})
