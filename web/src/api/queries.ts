import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEventSource } from "@/hooks/use-event-source"
import { api, type SessionView, type SessionsEvent, unwrap } from "./client"

export const keys = {
  auth: ["auth"] as const,
  sources: ["sources"] as const,
  artifacts: (source: string) => ["artifacts", source] as const,
  providers: ["providers"] as const,
  sessions: ["sessions"] as const,
}

export function useAuth() {
  return useQuery({
    queryKey: keys.auth,
    queryFn: () => unwrap(api.GET("/api/v1/auth")),
    staleTime: Infinity,
    retry: false,
  })
}

export function useMe() {
  const auth = useAuth()
  return { ...auth, data: auth.data?.identity }
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (password: string) => unwrap(api.POST("/api/v1/auth/login", { body: { password } })),
    onSuccess: (status) => qc.setQueryData(keys.auth, status),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/auth/logout")),
    onSuccess: () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.auth[0] })
      void qc.invalidateQueries({ queryKey: keys.auth })
    },
  })
}

export function useSources() {
  return useQuery({
    queryKey: keys.sources,
    queryFn: () => unwrap(api.GET("/api/v1/sources")),
    staleTime: Infinity,
  })
}

export function useArtifacts(source: string) {
  return useQuery({
    queryKey: keys.artifacts(source),
    queryFn: () =>
      unwrap(api.GET("/api/v1/artifacts", { params: { query: source ? { source, limit: 100 } : { limit: 100 } } })),
    refetchInterval: (query) => (query.state.data?.items.some((a) => !a.meta) ? 3_000 : 60_000),
    placeholderData: keepPreviousData,
  })
}

export function useProviders() {
  return useQuery({
    queryKey: keys.providers,
    queryFn: () => unwrap(api.GET("/api/v1/providers")),
    refetchInterval: 10_000,
  })
}

export function useSessions() {
  return useQuery({
    queryKey: keys.sessions,
    queryFn: () => unwrap(api.GET("/api/v1/sessions")),
  })
}

export function useSessionEvents() {
  const qc = useQueryClient()
  useEventSource<SessionsEvent>("/api/v1/events", "sessions", (event) => {
    qc.setQueryData(keys.sessions, event)
    void qc.invalidateQueries({ queryKey: keys.providers })
  })
}

export function useSession(provider: string, id: string) {
  const sessions = useSessions()
  const session = sessions.data?.items.find((s) => s.provider === provider && s.id === id)
  return { ...sessions, session }
}

export type LaunchInput = { source: string; artifactId: string; provider: string; location?: string }

export function useLaunch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LaunchInput) => unwrap(api.POST("/api/v1/sessions", { body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sessions })
      void qc.invalidateQueries({ queryKey: keys.providers })
    },
  })
}

export function useStopSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: Pick<SessionView, "provider" | "id">) =>
      unwrap(api.DELETE("/api/v1/sessions/{provider}/{id}", { params: { path: { provider: s.provider, id: s.id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sessions })
      void qc.invalidateQueries({ queryKey: keys.providers })
    },
  })
}

export function useExtendSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: Pick<SessionView, "provider" | "id">) =>
      unwrap(
        api.POST("/api/v1/sessions/{provider}/{id}/extend", { params: { path: { provider: s.provider, id: s.id } } }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.sessions }),
  })
}

export function canManage(me: { user: string; admin: boolean } | undefined, s: SessionView) {
  return !!me && (me.admin || me.user === s.owner)
}
