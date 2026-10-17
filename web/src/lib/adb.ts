import { Adb, AdbDaemonTransport, AdbPacket, AdbPacketSerializeStream, escapeArg } from "@yume-chan/adb"
import AdbWebCredentialStore from "@yume-chan/adb-credential-web"
import {
  MaybeConsumable,
  pipeFrom,
  type ReadableStream,
  StructDeserializeStream,
  WritableStream,
} from "@yume-chan/stream-extra"
import { openSocket, socketStream } from "@/lib/scrcpy"

// Below the agent's WebSocket read limit (contract.TunnelReadLimit).
const chunkSize = 64 * 1024

const credentials = new AdbWebCredentialStore("Holtdroid")

export function adbURL(base: string) {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws"
  return `${scheme}://${window.location.host}${base}/adb`
}

export async function connectAdb(url: string): Promise<Adb> {
  const { ws, opened } = openSocket(url)
  await opened
  const sink = new MaybeConsumable.WritableStream<Uint8Array>({
    write(chunk) {
      for (let i = 0; i < chunk.length; i += chunkSize)
        ws.send(chunk.subarray(i, i + chunkSize) as Uint8Array<ArrayBuffer>)
    },
    close() {
      ws.close()
    },
  })
  const connection = {
    readable: socketStream(ws).pipeThrough(new StructDeserializeStream(AdbPacket)),
    writable: pipeFrom(sink, new AdbPacketSerializeStream()),
  }
  try {
    const transport = await AdbDaemonTransport.authenticate({ serial: url, connection, credentialStore: credentials })
    return new Adb(transport)
  } catch (e) {
    ws.close()
    throw e
  }
}

export const shq = escapeArg

export async function run(adb: Adb, command: string): Promise<string> {
  return adb.subprocess.noneProtocol.spawnWaitText(command)
}

export async function readFile(adb: Adb, path: string): Promise<Blob> {
  const sync = await adb.sync()
  try {
    const parts: Uint8Array<ArrayBuffer>[] = []
    await sync.read(path).pipeTo(
      new WritableStream<Uint8Array>({
        write(chunk) {
          parts.push(new Uint8Array(chunk))
        },
      }),
    )
    return new Blob(parts)
  } finally {
    await sync.dispose()
  }
}

export async function writeFile(adb: Adb, path: string, file: Blob, onProgress?: (sent: number) => void) {
  let sent = 0
  const progress = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      sent += chunk.byteLength
      onProgress?.(sent)
      controller.enqueue(chunk)
    },
  })
  const sync = await adb.sync()
  try {
    await sync.write({
      filename: path,
      file: file.stream().pipeThrough(progress) as unknown as ReadableStream<Uint8Array>,
      permission: 0o644,
      mtime: Math.floor(Date.now() / 1000),
    })
  } finally {
    await sync.dispose()
  }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}
