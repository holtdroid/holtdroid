import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { topics } from "./topics.mjs"

const root = new URL("./content/docs/", import.meta.url)

/** @param {string} text @param {string} key */
const field = (text, key) => {
  const value = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1].trim() ?? ""
  return value.replace(/^(["'])(.*)\1$/, "$2")
}

/** @param {string} directory */
const pages = (directory) =>
  readdirSync(new URL(directory, root), { recursive: true, encoding: "utf8" })
    .filter((file) => /\.mdx?$/.test(file))
    .map((file) => {
      const text = readFileSync(new URL(join(directory, file), root), "utf8")
      const order = Number(text.match(/^\s+order:\s*(\d+)/m)?.[1] ?? 999)
      const slug = join(directory, file).replace(/\.mdx?$/, "")
      return { slug, order, title: field(text, "title"), description: field(text, "description") }
    })
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))

/** @param {string} site */
export const pageIndex = (site) =>
  topics
    .flatMap((topic) => topic.items)
    .map((section) => {
      const directory = section.items[0].autogenerate.directory
      const lines = pages(directory).map((p) => `- [${p.title}](${site}/${p.slug}/): ${p.description}`)
      return `${section.label}:\n\n${lines.join("\n")}`
    })
    .join("\n\n")
