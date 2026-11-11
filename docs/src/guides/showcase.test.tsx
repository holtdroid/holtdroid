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

const { hero, moments } = await import("../components/landing/moments")
const { Portal } = await import("./portal")
const { sceneState } = await import("./showcase")
const { guideIds } = await import("./scenarios")

test("the hero scene renders the session page", () => {
  expect(renderToStaticMarkup(<Portal s={sceneState(hero.state)} />)).toContain("/session/")
})

test.each(moments.map((m) => [m.step, m] as const))("%s links a guide and renders", (_, moment) => {
  expect(guideIds).toContain(moment.guide)
  const page = moment.href.replace(/^\//, "").replace(/\/$/, ".mdx")
  expect(existsSync(join(import.meta.dir, "../content/docs", page))).toBe(true)
  expect(page).toEndWith(`/${moment.guide}.mdx`)
  expect(renderToStaticMarkup(<Portal s={sceneState(moment.state)} />).length).toBeGreaterThan(0)
})
