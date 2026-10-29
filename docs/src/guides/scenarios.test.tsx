import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"

Bun.plugin({
  name: "vite-url",
  setup(build) {
    build.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: "vite-url" }))
    build.onLoad({ filter: /.*/, namespace: "vite-url" }, () => ({
      contents: 'export default "asset.svg"',
      loader: "js",
    }))
  },
})

const { Portal } = await import("./portal")
const { guideIds, loadScenario } = await import("./scenarios")
const { apply, stateAt } = await import("./state")

const docs = join(import.meta.dir, "../content/docs")
const langs = ["en", "ru", "uk"] as const

function pages(id: string) {
  const found: string[] = []
  for (const prefix of ["", "ru/", "uk/"]) {
    const dir = join(docs, `${prefix}guides`)
    for (const section of ["first-steps", "web", "conditions", "app", "design", "recordings", "developers"]) {
      const file = join(dir, section, `${id}.mdx`)
      if (existsSync(file)) found.push(file)
    }
  }
  return found
}

describe.each(guideIds)("%s", (id) => {
  test("every step is written in every language", async () => {
    const sc = await loadScenario(id)
    expect(sc.steps.length).toBeGreaterThan(0)
    for (const step of sc.steps)
      for (const lang of langs) {
        expect(step.text[lang].trim()).not.toBe("")
        expect(step.text[lang]).not.toContain("TODO")
      }
  })

  test("every step points at something on the screen", async () => {
    const sc = await loadScenario(id)
    let s = stateAt(sc, { index: 0, phase: "move", typed: 0 })
    for (const [i, step] of sc.steps.entries()) {
      if (step.target) {
        const html = renderToStaticMarkup(<Portal s={s} />)
        expect(html.includes(`data-g="${step.target}"`), `step ${i + 1} targets “${step.target}”`).toBe(true)
      }
      s = apply(s, step)
    }
  })

  test("has a page in English, Russian and Ukrainian", () => {
    const files = pages(id)
    expect(files.length).toBe(3)
    for (const file of files) expect(readFileSync(file, "utf8")).toContain(`<Guide id="${id}" />`)
  })
})
