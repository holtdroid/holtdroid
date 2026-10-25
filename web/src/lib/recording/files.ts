/** Where a recording's files come from: the server, or an archive on disk. */
export interface RecordingFiles {
  /** a file's bytes, for the video */
  bytes(name: string): Promise<ArrayBuffer>
  /** a text file; .gz files are unpacked */
  text(name: string): Promise<string>
}

export function remoteFiles(base: string): RecordingFiles {
  const get = async (name: string) => {
    const r = await fetch(base + name)
    if (!r.ok) throw new Error(`${name}: ${r.status}`)
    return r
  }
  return {
    bytes: async (name) => (await get(name)).arrayBuffer(),
    // the server marks .gz files as gzip, so the browser unpacks them already
    text: async (name) => (await get(name)).text(),
  }
}

export function gunzipText(blob: Blob): Promise<string> {
  return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text()
}
