import type { RecordingManifest, RecordingView } from "@/api/client"
import type { RecordingFiles } from "@/lib/recording/files"

const levelStyle: Record<string, string> = { V: "90", D: "94", I: "32", W: "33", E: "31", F: "1;35", A: "1;35" }
const timed = /^(\d+:\d\d:\d\d\.\d{3}) {2}(\S+ \S+)\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s+(.*?)\s*: (.*)$/

const sgr = (code: string, s: string) => `\x1b[${code}m${s}\x1b[0m`

/** The same colouring the server does for a .log download, for a file opened from disk. */
export function colorLogLine(line: string) {
  const m = timed.exec(line)
  if (!m) return sgr("90", line)
  const [, rec, stamp, pid, tid, level, tag, message] = m as unknown as string[] as [string, ...string[]]
  const style = levelStyle[level!]!
  const loud = level === "W" || level === "E" || level === "F" || level === "A"
  return [
    sgr("90", rec!),
    "  ",
    sgr("2", stamp!),
    " ",
    sgr("2", `${pid} ${tid}`),
    " ",
    sgr(`1;${style}`, level!),
    " ",
    sgr(loud ? style : "36", tag!),
    ": ",
    loud ? sgr(style, message!) : message,
  ].join("")
}

/** The whole logcat of a recording as one file, plain or with ANSI colours by level. */
export async function buildLogcat(
  files: RecordingFiles,
  manifest: RecordingManifest,
  recording: Pick<RecordingView, "label" | "package" | "versionName">,
  colored: boolean,
): Promise<Blob> {
  const title = `# ${recording.label || recording.package} ${recording.versionName ?? ""}, recording started ${manifest.startedAt}; times are since the start`
  const parts: string[] = colored
    ? [
        `${sgr("90", title)}\n`,
        `${sgr("90", "# levels: ")}${sgr("90", "V")} ${sgr("94", "D")} ${sgr("32", "I")} ${sgr("33", "W")} ${sgr("31", "E")} ${sgr("1;35", "F")}${sgr("90", "; view with colours: less -R, bat, lnav or an ANSI-aware editor")}\n`,
      ]
    : [`${title}\n`]
  for (const chunk of manifest.logcat) {
    let text: string
    try {
      text = await files.text(chunk.file)
    } catch {
      continue
    }
    parts.push(
      colored
        ? text
            .split("\n")
            .map((l) => (l ? `${colorLogLine(l)}\n` : ""))
            .join("")
        : text,
    )
  }
  return new Blob(parts, { type: "text/plain" })
}
