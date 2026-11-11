import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dir, path), "utf8")

function block(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`${selector} not found`)
  const body = css.slice(start, css.indexOf("}", start))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]!.trim()]))
}

const pairs = {
  bg: "background",
  sf: "card",
  sf2: "muted",
  sf3: "accent",
  bd: "border",
  bd2: "border-subtle",
  tx: "foreground",
  mu: "muted-foreground",
  inv: "primary",
  invtx: "primary-foreground",
  ok: "success",
  okbg: "success-soft",
  in: "info",
  inbg: "info-soft",
  wa: "warning",
  wabg: "warning-soft",
  er: "danger",
  erbg: "danger-soft",
  vi: "violet",
  vibg: "violet-soft",
  frame: "frame",
  stage: "stage",
  veil: "veil",
  shadow: "float-shadow",
}

const web = read("../../../web/src/theme.css")
const docs = read("tokens.css")

test.each([
  ["light", ':root[data-theme="light"]', ":root"],
  ["dark", ':root[data-theme="dark"]', ".dark"],
])("the docs %s tokens match the portal", (_, docsSelector, webSelector) => {
  const d = block(docs, docsSelector)
  const w = block(web, webSelector)
  for (const [ours, theirs] of Object.entries(pairs)) {
    expect({ token: ours, value: d[`hd-${ours}`] }).toEqual({ token: ours, value: w[theirs] })
  }
})
