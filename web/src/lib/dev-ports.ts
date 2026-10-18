const devProcesses = [
  "node",
  "bun",
  "deno",
  "python",
  "ruby",
  "php",
  "java",
  "dotnet",
  "go",
  "nginx",
  "caddy",
  "httpd",
  "beam.smp",
  "uvicorn",
  "gunicorn",
  "puma",
  "next-server",
  "vite",
  "esbuild",
  "mitmproxy",
  "mitmweb",
  "charles",
]

export function isDevServer(process: string | undefined) {
  if (!process) return false
  const name = process.toLowerCase()
  return devProcesses.some((p) => name === p || name.startsWith(p))
}

export type PortGroups = { main: number[]; other: number[] }

// main holds what is published or looks like a dev server; the rest of the
// computer's listeners (system services, desktop apps) go to other.
export function groupPorts(listening: { port: number; process?: string }[], published: number[]): PortGroups {
  const processes = new Map(listening.map((p) => [p.port, p.process]))
  const all = [...new Set([...listening.map((p) => p.port), ...published])].toSorted((a, b) => a - b)
  const main: number[] = []
  const other: number[] = []
  for (const port of all) {
    if (published.includes(port) || !processes.has(port) || isDevServer(processes.get(port))) main.push(port)
    else other.push(port)
  }
  return { main, other }
}
