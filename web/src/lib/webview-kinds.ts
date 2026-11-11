type Build = { package: string; channels: string[] }

const labels: Record<string, string> = {
  "com.google.android.webview": "Chrome WebView",
  "com.android.webview": "Chromium WebView",
}

export const kindLabel = (pkg: string) => labels[pkg] ?? pkg

const blurbs: Record<string, string> = {
  "com.google.android.webview": "With H.264 and AAC",
  "com.android.webview": "Open source",
}

export const kindBlurb = (pkg: string) => blurbs[pkg] ?? ""

export function visibleBuilds<T extends { id: string }>(builds: T[], selected: string, size: number) {
  if (builds.length <= size + 1) return builds
  const index = builds.findIndex((b) => b.id === selected)
  if (index < size) return builds.slice(0, size)
  return [...builds.slice(0, size - 1), builds[index]!]
}

export function webviewKinds<T extends Build>(builds: T[], preferred?: string) {
  const packages = [...new Set(builds.map((b) => b.package))]
  return packages
    .map((pkg) => ({ package: pkg, label: kindLabel(pkg), builds: builds.filter((b) => b.package === pkg) }))
    .toSorted((a, b) => Number(b.package === preferred) - Number(a.package === preferred))
}

export const newestStable = <T extends Build>(builds: T[]) =>
  builds.find((b) => b.channels.includes("stable")) ?? builds[0]

export function defaultWebView<T extends Build>(builds: T[], preferred?: string) {
  const ofKind = builds.filter((b) => b.package === preferred)
  return newestStable(ofKind.length > 0 ? ofKind : builds)
}
