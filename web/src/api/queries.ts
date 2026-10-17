import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEventSource } from "@/hooks/use-event-source"
import {
  api,
  type ArtifactView,
  type ArtifactsEvent,
  type SessionView,
  type SessionsEvent,
  unwrap,
  type Visibility,
} from "./client"

export const keys = {
  auth: ["auth"] as const,
  sources: ["sources"] as const,
  uploads: ["uploads"] as const,
  allArtifacts: ["artifacts"] as const,
  artifacts: (source: string) => ["artifacts", source] as const,
  artifact: (source: string, id: string) => ["artifacts", source, id] as const,
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
    refetchInterval: (query) => (query.state.data?.items.some((a) => !a.app) ? 3_000 : 60_000),
    placeholderData: keepPreviousData,
  })
}

export function useArtifact(source: string, id: string) {
  return useQuery({
    queryKey: keys.artifact(source, id),
    queryFn: () => unwrap(api.GET("/api/v1/artifacts/{source}/{id}", { params: { path: { source, id } } })),
    enabled: source !== "" && id !== "",
    retry: false,
  })
}

export function useUploads() {
  return useQuery({
    queryKey: keys.uploads,
    queryFn: () => unwrap(api.GET("/api/v1/uploads")),
    staleTime: Infinity,
  })
}

export type UploadInput = { file: File; visibility: Visibility; temporary: boolean; note?: string; changelog?: string }

export function useUpload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, temporary, ...rest }: UploadInput) => {
      const fields = { ...rest, temporary: temporary ? ("true" as const) : ("false" as const) }
      const form = new FormData()
      form.append("file", file, file.name)
      for (const [key, value] of Object.entries(fields)) {
        if (value) form.append(key, value)
      }
      return unwrap(api.POST("/api/v1/uploads", { body: { file: file.name, ...fields }, bodySerializer: () => form }))
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.allArtifacts }),
  })
}

function artifactPath(a: Pick<ArtifactView, "source" | "id">) {
  return { path: { source: a.source, id: a.id } }
}

export function useUpdateArtifact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ artifact, ...body }: { artifact: ArtifactView; visibility?: Visibility; temporary?: boolean }) =>
      unwrap(api.PATCH("/api/v1/artifacts/{source}/{id}", { params: artifactPath(artifact), body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.allArtifacts }),
  })
}

export function useDeleteArtifact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (artifact: ArtifactView) =>
      unwrap(api.DELETE("/api/v1/artifacts/{source}/{id}", { params: artifactPath(artifact) })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.allArtifacts }),
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
  useEventSource<{ sessions: SessionsEvent; artifacts: ArtifactsEvent }>("/api/v1/events", {
    sessions: (event) => {
      qc.setQueryData(keys.sessions, event)
      void qc.invalidateQueries({ queryKey: keys.providers })
    },
    artifacts: () => void qc.invalidateQueries({ queryKey: keys.allArtifacts }),
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

export type InstallInput = { session: Pick<SessionView, "provider" | "id">; artifact: ArtifactView; keepData: boolean }

export function useInstallBuild() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ session, artifact, keepData }: InstallInput) =>
      unwrap(
        api.POST("/api/v1/sessions/{provider}/{id}/install", {
          params: { path: { provider: session.provider, id: session.id } },
          body: { source: artifact.source, artifactId: artifact.id, keepData },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.sessions }),
  })
}
