export const docsUrl = "https://holtdroid.github.io/"

export function docsUrlWithReturn(returnUrl: string) {
  return `${docsUrl}#returnUrl=${encodeURIComponent(returnUrl)}`
}

export function openDocs() {
  window.open(docsUrlWithReturn(window.location.href), "_blank", "noopener,noreferrer")
}
