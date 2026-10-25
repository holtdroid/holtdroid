export const md = {
  surface: "#101411",
  container: "#1c211e",
  containerHigh: "#262b28",
  containerHighest: "#313633",
  onSurface: "#e0e3de",
  onSurfaceVariant: "#c0c9c1",
  outline: "#8a938c",
  outlineVariant: "#404943",
  primary: "#78dc9a",
  onPrimary: "#003919",
  primaryContainer: "#0a5230",
  onPrimaryContainer: "#94f7b5",
  secondaryContainer: "#354b3b",
  onSecondaryContainer: "#d1e8d5",
  warn: "#f2c162",
  warnContainer: "#4a3a0a",
  error: "#ffb4ab",
  errorContainer: "#93000a",
  onErrorContainer: "#ffdad6",
}

export const series = {
  primary: "#78dc9a",
  blue: "#a8c8ff",
  purple: "#d0bcff",
  amber: "#f2c162",
  teal: "#7fdcd0",
  error: "#ffb4ab",
} as const

export type SeriesName = keyof typeof series

export const logLevels: Record<string, { color: string; name: string }> = {
  V: { color: "#bbbbbb", name: "Verbose" },
  D: { color: "#6fa8dc", name: "Debug" },
  I: { color: "#6a9955", name: "Info" },
  W: { color: "#d7ba7d", name: "Warn" },
  E: { color: "#ff6b68", name: "Error" },
  F: { color: "#ff6b68", name: "Fatal" },
  A: { color: "#ff6b68", name: "Assert" },
}

export const levelRank: Record<string, number> = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5, A: 5 }

export const sans = '"Google Sans Text", "Google Sans", Roboto, "Geist Variable", system-ui, sans-serif'
export const mono = '"Roboto Mono", ui-monospace, "SF Mono", Menlo, monospace'
