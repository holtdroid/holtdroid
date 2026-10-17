import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { fingerprint, type ParsedKey } from "@/lib/ssh-key"
import { addKey, listKeys, onKeysChanged, removeKey, renameKey, type StoredKey } from "@/lib/ssh-store"
import { ApiError, api, unwrap } from "./client"
import { useMe } from "./queries"

export const SYNC_INTERVAL = 5 * 60_000

const sshKeys = {
  info: ["ssh"] as const,
  keys: (user: string) => ["ssh", "keys", user] as const,
  request: (code: string) => ["ssh", "request", code] as const,
  sync: (user: string, blobs: string[]) => ["ssh", "sync", user, blobs] as const,
}

export function useSSHInfo() {
  return useQuery({
    queryKey: sshKeys.info,
    queryFn: () => unwrap(api.GET("/api/v1/ssh")),
    staleTime: Infinity,
  })
}

export function useSSHKeyRequest(code: string) {
  return useQuery({
    queryKey: sshKeys.request(code),
    queryFn: () => unwrap(api.GET("/api/v1/ssh/key-requests/{code}", { params: { path: { code } } })),
    staleTime: Infinity,
  })
}

export function useSSHKeys() {
  const user = useMe().data?.user ?? ""
  const qc = useQueryClient()
  useEffect(() => onKeysChanged(() => void qc.invalidateQueries({ queryKey: sshKeys.keys(user) })), [qc, user])
  return useQuery({
    queryKey: sshKeys.keys(user),
    queryFn: () => listKeys(user),
    enabled: !!user,
    staleTime: Infinity,
  })
}

export function useSSHKeySync() {
  const user = useMe().data?.user ?? ""
  const info = useSSHInfo()
  const keys = useSSHKeys()
  const blobs = keys.data?.map((k) => k.blob) ?? []
  const sync = useQuery({
    queryKey: sshKeys.sync(user, blobs),
    queryFn: () =>
      unwrap(
        api.PUT("/api/v1/ssh/keys", {
          body: { keys: (keys.data ?? []).map((k) => ({ name: k.name, publicKey: k.publicKey })) },
        }),
      ),
    enabled: !!user && !!info.data?.enabled && keys.isSuccess,
    staleTime: SYNC_INTERVAL,
    refetchInterval: SYNC_INTERVAL,
  })

  const keyErrors = new Map<string, string>()
  if (sync.error instanceof ApiError) {
    for (const d of sync.error.details) {
      const index = /^body\.keys\[(\d+)\]/.exec(d.location ?? "")?.[1]
      const key = index === undefined ? undefined : keys.data?.[Number(index)]
      if (key && d.message) keyErrors.set(key.blob, d.message)
    }
  }
  return { ...sync, enabled: info.data?.enabled, keyErrors }
}

function useKeyMutation<T, R>(fn: (input: T) => Promise<R>) {
  const user = useMe().data?.user ?? ""
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: sshKeys.keys(user) }),
  })
}

export function useAddSSHKey() {
  const user = useMe().data?.user ?? ""
  return useKeyMutation(async ({ key, name }: { key: ParsedKey; name: string }) => {
    const stored: StoredKey = {
      user,
      blob: key.blob,
      name,
      publicKey: key.line,
      type: key.type,
      bits: key.bits,
      fingerprint: await fingerprint(key.blob),
      addedAt: Date.now(),
    }
    await addKey(stored)
    return stored
  })
}

export function useRestoreSSHKey() {
  return useKeyMutation(addKey)
}

export function useRenameSSHKey() {
  return useKeyMutation(({ key, name }: { key: StoredKey; name: string }) => renameKey(key, name))
}

export function useRemoveSSHKey() {
  return useKeyMutation(removeKey)
}
