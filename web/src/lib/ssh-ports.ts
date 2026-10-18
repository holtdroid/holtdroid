export function localURL(port: number) {
  if (port === 80) return "http://localhost"
  if (port === 443) return "https://localhost"
  return `http://localhost:${port}`
}
