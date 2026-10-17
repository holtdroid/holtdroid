import geistFaces from "@fontsource-variable/geist/index.css?inline"
import type { DevToolsPrefs } from "@/lib/devtools-prefs"

const styleID = "holtdroid-style"

const grayFamilies = ["primary", "secondary", "neutral", "neutral-variant"]
const tones = [
  0, 4, 6, 10, 12, 15, 17, 20, 22, 24, 25, 30, 35, 40, 50, 55, 60, 70, 80, 87, 90, 92, 94, 95, 96, 98, 99, 100,
]

const palette = grayFamilies.flatMap((f) => tones.map((t) => `--ref-palette-${f}${t}: lab(${t} 0 0) !important;`))

const darkSurfaces = [5, 8, 11, 12, 14].map(
  (p, i) => `--sys-color-surface${i + 1}: color-mix(in srgb, white ${p}%, var(--ref-palette-neutral10)) !important;`,
)

const css = `${geistFaces}
:root {
  ${palette.join("\n  ")}
  --default-font-family: "Geist Variable", system-ui, sans-serif !important;
  --monospace-font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace !important;
  --source-code-font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace !important;
}
:root.theme-with-dark-background {
  ${darkSurfaces.join("\n  ")}
}
`

function setBoth(names: string[], value: unknown) {
  for (const name of names) localStorage.setItem(name, JSON.stringify(value))
}

export function prepareDevTools(prefs: DevToolsPrefs) {
  try {
    setBoth(["screencast-enabled", "screencastEnabled"], prefs.screencast)
    if (prefs.portalStyle) setBoth(["ui-theme", "uiTheme"], "systemPreferred")
  } catch {
    return
  }
}

export function styleDevTools(frame: HTMLIFrameElement, prefs: DevToolsPrefs) {
  let doc: Document | null
  try {
    doc = frame.contentDocument
  } catch {
    return
  }
  if (!doc?.head) return
  doc.getElementById(styleID)?.remove()
  if (!prefs.portalStyle) return
  const style = doc.createElement("style")
  style.id = styleID
  style.textContent = css
  doc.head.append(style)
}
