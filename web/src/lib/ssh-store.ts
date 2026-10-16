export type StoredKey = {
  user: string
  blob: string
  name: string
  publicKey: string
  type: string
  bits?: number
  fingerprint: string
  addedAt: number
}

const STORE = "ssh-keys"

let db: Promise<IDBDatabase> | undefined

function openDB() {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("holtdroid", 1)
    req.addEventListener("upgradeneeded", () => {
      const store = req.result.createObjectStore(STORE, { keyPath: ["user", "blob"] })
      store.createIndex("user", "user")
    })
    req.addEventListener("success", () => resolve(req.result))
    req.addEventListener("error", () => {
      db = undefined
      reject(req.error ?? new Error("Could not open browser storage"))
    })
  })
  return db
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  const store = (await openDB()).transaction(STORE, mode).objectStore(STORE)
  return new Promise<T>((resolve, reject) => {
    const req = fn(store)
    req.addEventListener("success", () => resolve(req.result))
    req.addEventListener("error", () => reject(req.error ?? new Error("Browser storage failed")))
  })
}

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("holtdroid-ssh-keys")

function changed() {
  channel?.postMessage("changed")
}

export function onKeysChanged(listener: () => void) {
  channel?.addEventListener("message", listener)
  return () => channel?.removeEventListener("message", listener)
}

export async function listKeys(user: string) {
  const keys = await run<StoredKey[]>("readonly", (s) => s.index("user").getAll(user))
  return keys.toSorted((a, b) => a.addedAt - b.addedAt)
}

export async function addKey(key: StoredKey) {
  try {
    await run("readwrite", (s) => s.add(key))
  } catch (err) {
    if (err instanceof DOMException && err.name === "ConstraintError") {
      throw new Error("This key is already in your list", { cause: err })
    }
    throw err
  }
  changed()
}

export async function renameKey(key: StoredKey, name: string) {
  await run("readwrite", (s) => s.put({ ...key, name }))
  changed()
}

export async function removeKey(key: StoredKey) {
  await run("readwrite", (s) => s.delete([key.user, key.blob]))
  changed()
}
