import {
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { components } from "./schema"
import { api, unwrap } from "./client"
import { keys } from "./queries"

type Schemas = components["schemas"]
export type UserView = Schemas["UserView"]
export type UserDetail = Schemas["UserDetail"]
export type UserList = Schemas["UserList"]
export type Overrides = Schemas["Overrides"]
export type EffectiveLimits = Schemas["EffectiveLimits"]
export type Invite = Schemas["Invite"]
export type InviteInfo = Schemas["InviteInfo"]
export type Passkey = Schemas["Passkey"]
export type Role = UserView["role"]

export const roleLabel: Record<Role, string> = { admin: "Admin", user: "User", "": "Waiting for approval" }

const userKeys = {
  account: ["account"] as const,
  users: ["admin", "users"] as const,
  user: (id: string) => ["admin", "users", id] as const,
  invites: ["admin", "invites"] as const,
  invite: (token: string) => ["invite", token] as const,
}

function asRequest(options: unknown) {
  return options as PublicKeyCredentialRequestOptionsJSON
}

function asCreation(options: unknown) {
  return options as PublicKeyCredentialCreationOptionsJSON
}

export function usePasskeySignIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const begin = await unwrap(api.POST("/api/v1/auth/passkey/begin"))
      const credential = await startAuthentication({ optionsJSON: asRequest(begin.options) })
      return unwrap(api.POST("/api/v1/auth/passkey/finish", { body: { credential } }))
    },
    onSuccess: (status) => qc.setQueryData(keys.auth, status),
  })
}

export function useInvite(token: string) {
  return useQuery({
    queryKey: userKeys.invite(token),
    queryFn: () => unwrap(api.GET("/api/v1/auth/invites/{token}", { params: { path: { token } } })),
    retry: false,
  })
}

export function useRegister(token: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name?: string; email?: string; keyName?: string }) => {
      const path = { token }
      const begin = await unwrap(
        api.POST("/api/v1/auth/invites/{token}/begin", {
          params: { path },
          body: { name: input.name, email: input.email },
        }),
      )
      const credential = await startRegistration({ optionsJSON: asCreation(begin.options) })
      return unwrap(
        api.POST("/api/v1/auth/invites/{token}/finish", {
          params: { path },
          body: { credential, name: input.keyName },
        }),
      )
    },
    onSuccess: (status) => qc.setQueryData(keys.auth, status),
  })
}

export function useAccount() {
  return useQuery({ queryKey: userKeys.account, queryFn: () => unwrap(api.GET("/api/v1/account")) })
}

export function useRenameAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => unwrap(api.PATCH("/api/v1/account", { body: { name } })),
    onSuccess: (account) => {
      qc.setQueryData(userKeys.account, account)
      void qc.invalidateQueries({ queryKey: keys.auth })
    },
  })
}

export function useAddPasskey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const begin = await unwrap(api.POST("/api/v1/account/passkeys/begin"))
      const credential = await startRegistration({ optionsJSON: asCreation(begin.options) })
      return unwrap(api.POST("/api/v1/account/passkeys/finish", { body: { credential, name } }))
    },
    onSuccess: (account) => qc.setQueryData(userKeys.account, account),
  })
}

export function useRenamePasskey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      unwrap(api.PATCH("/api/v1/account/passkeys/{id}", { params: { path: { id } }, body: { name } })),
    onSuccess: (account) => qc.setQueryData(userKeys.account, account),
  })
}

export function useDeletePasskey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE("/api/v1/account/passkeys/{id}", { params: { path: { id } } })),
    onSuccess: (account) => qc.setQueryData(userKeys.account, account),
  })
}

export function useUsers() {
  return useQuery({ queryKey: userKeys.users, queryFn: () => unwrap(api.GET("/api/v1/admin/users")) })
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: userKeys.user(id ?? ""),
    queryFn: () => unwrap(api.GET("/api/v1/admin/users/{id}", { params: { path: { id: id ?? "" } } })),
    enabled: !!id,
  })
}

function useUserMutation<T>(fn: (input: T) => Promise<UserDetail | undefined>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => {
      if (detail) qc.setQueryData(userKeys.user(detail.id), detail)
      void qc.invalidateQueries({ queryKey: userKeys.users })
    },
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; email: string; role: Role; ttl: number }) =>
      unwrap(api.POST("/api/v1/admin/users", { body })),
    onSuccess: (created) => {
      qc.setQueryData(userKeys.user(created.user.id), created.user)
      void qc.invalidateQueries({ queryKey: userKeys.users })
    },
  })
}

export function useUpdateUser() {
  return useUserMutation((input: { id: string; name: string; email: string; role: Role; limits: Overrides }) =>
    unwrap(
      api.PUT("/api/v1/admin/users/{id}", {
        params: { path: { id: input.id } },
        body: { name: input.name, email: input.email, role: input.role, limits: input.limits },
      }),
    ),
  )
}

export function useDeleteUser() {
  return useUserMutation(async (id: string) => {
    await unwrap(api.DELETE("/api/v1/admin/users/{id}", { params: { path: { id } } }))
    return undefined
  })
}

export function useDeleteUserPasskey() {
  return useUserMutation(({ id, passkey }: { id: string; passkey: string }) =>
    unwrap(api.DELETE("/api/v1/admin/users/{id}/passkeys/{passkey}", { params: { path: { id, passkey } } })),
  )
}

export function useRecoveryLink() {
  return useMutation({
    mutationFn: ({ id, ttl }: { id: string; ttl: number }) =>
      unwrap(api.POST("/api/v1/admin/users/{id}/recovery", { params: { path: { id } }, body: { ttl } })),
  })
}

export function useInvites() {
  return useQuery({ queryKey: userKeys.invites, queryFn: () => unwrap(api.GET("/api/v1/admin/invites")) })
}

export function useCreateInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { role: Role; domains: string[]; note: string; singleUse: boolean; ttl: number }) =>
      unwrap(api.POST("/api/v1/admin/invites", { body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: userKeys.invites }),
  })
}

export function useDeleteInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE("/api/v1/admin/invites/{id}", { params: { path: { id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: userKeys.invites }),
  })
}

export function passkeyError(error: Error) {
  if (error.name === "NotAllowedError") return "The passkey prompt was closed or timed out."
  if (error.name === "InvalidStateError") return "This passkey is already registered."
  return error.message
}
