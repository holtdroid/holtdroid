import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEventSource } from "@/hooks/use-event-source"
import { recordPreference } from "@/lib/launch-prefs"
import { readEvents } from "@/lib/recording/bundle"
import type { RecordingFiles } from "@/lib/recording/files"
import {
  api,
  type AppDataChoice,
  type AppDataView,
  type RecordingDetail,
  type RecordingEvent,
  type RecordingManifest,
  type RecordingMarker,
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
  appData: ["app-data"] as const,
  recordings: ["recordings"] as const,
  recording: (id: string) => ["recordings", id] as const,
  shared: (token: string) => ["shared", token] as const,
  webviews: ["webviews"] as const,
  map: ["map"] as const,
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
      unwrap(api.GET("/api/v1/artifacts", { params: { query: source ? { source, limit: 500 } : { limit: 500 } } })),
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

export function artifactDownloadURL(a: Pick<ArtifactView, "source" | "id">) {
  return `/api/v1/artifacts/${encodeURIComponent(a.source)}/${encodeURIComponent(a.id)}/download`
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

export function useWebViews(enabled = true) {
  return useQuery({
    queryKey: keys.webviews,
    queryFn: () => unwrap(api.GET("/api/v1/webviews")),
    staleTime: 5 * 60_000,
    enabled,
  })
}

export function useMap() {
  return useQuery({
    queryKey: keys.map,
    queryFn: () => unwrap(api.GET("/api/v1/map")),
    staleTime: Infinity,
  })
}

export function useRoadRoute(
  points: { latitude: number; longitude: number }[],
  mode: "walk" | "run" | "drive",
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["map-route", mode, points],
    queryFn: () => unwrap(api.POST("/api/v1/map/route", { body: { points, mode } })),
    enabled: enabled && points.length >= 2,
    staleTime: Infinity,
    retry: false,
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

export type LaunchInput = {
  source: string
  artifactId: string
  provider?: string
  slot?: string
  screen?: string
  android?: string
  location?: string
  webview?: string
  appData?: AppDataChoice
  queue?: boolean
}

export function useLaunch() {
  const qc = useQueryClient()
  return async (body: LaunchInput, signal: AbortSignal) => {
    const record = recordPreference()
    const session = await unwrap(
      api.POST("/api/v1/sessions", { body: record === null ? body : { ...body, record }, signal }),
    )
    void qc.invalidateQueries({ queryKey: keys.sessions })
    void qc.invalidateQueries({ queryKey: keys.providers })
    return session
  }
}

export function useStopSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: Pick<SessionView, "provider" | "id">) =>
      unwrap(api.DELETE("/api/v1/sessions/{provider}/{id}", { params: { path: { provider: s.provider, id: s.id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sessions })
      void qc.invalidateQueries({ queryKey: keys.providers })
      void qc.invalidateQueries({ queryKey: keys.appData })
      void qc.invalidateQueries({ queryKey: keys.recordings })
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

export function useAppData() {
  return useQuery({
    queryKey: keys.appData,
    queryFn: () => unwrap(api.GET("/api/v1/app-data")),
    staleTime: 30_000,
  })
}

export function useAppDataFor(pkg: string | undefined) {
  const list = useAppData()
  const items = pkg ? (list.data?.items ?? []).filter((d) => d.package === pkg) : []
  return { ...list, items }
}

export function appDataDownloadURL(d: Pick<AppDataView, "package" | "id">) {
  return `/api/v1/app-data/${encodeURIComponent(d.package)}/${encodeURIComponent(d.id)}/download`
}

export function useDeleteAppData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: Pick<AppDataView, "package" | "id">) =>
      unwrap(api.DELETE("/api/v1/app-data/{package}/{id}", { params: { path: { package: d.package, id: d.id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.appData }),
  })
}

export function useSaveAppData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: Pick<SessionView, "provider" | "id">) =>
      unwrap(
        api.POST("/api/v1/sessions/{provider}/{id}/app-data", { params: { path: { provider: s.provider, id: s.id } } }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.appData }),
  })
}

export function useRecordings() {
  return useQuery({
    queryKey: keys.recordings,
    queryFn: () => unwrap(api.GET("/api/v1/recordings")),
    staleTime: 15_000,
    refetchInterval: (q) =>
      q.state.data?.items.some((r) => r.state === "recording" || r.state === "pending") ? 10_000 : false,
  })
}

export type ServerRecording = { kind: "own"; id: string } | { kind: "shared"; token: string }

/** A recording from the server, or a .holtdroid file opened in this browser. */
export type RecordingSource =
  | ServerRecording
  | { kind: "local"; id: string; files: RecordingFiles; manifest: RecordingManifest }

export function useRecordingDetail(source: ServerRecording) {
  return useQuery({
    queryKey: source.kind === "own" ? keys.recording(source.id) : keys.shared(source.token),
    queryFn: () =>
      source.kind === "own"
        ? unwrap(api.GET("/api/v1/recordings/{id}", { params: { path: { id: source.id } } }))
        : unwrap(api.GET("/api/v1/shared/{token}", { params: { path: { token: source.token } } })),
    refetchInterval: (q) => (q.state.data?.recording.state === "recording" ? 10_000 : false),
  })
}

export function useRecordingEvents(source: RecordingSource, version: number) {
  return useQuery({
    queryKey: [
      ...(source.kind === "own"
        ? keys.recording(source.id)
        : source.kind === "shared"
          ? keys.shared(source.token)
          : ["local", source.id]),
      "events",
      version,
    ],
    queryFn: async (): Promise<{ items: RecordingEvent[] }> => {
      if (source.kind === "local") return { items: await readEvents(source.files, source.manifest) }
      return source.kind === "own"
        ? unwrap(api.GET("/api/v1/recordings/{id}/events", { params: { path: { id: source.id } } }))
        : unwrap(api.GET("/api/v1/shared/{token}/events", { params: { path: { token: source.token } } }))
    },
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  })
}

function useRecordingMutation<T, R>(fn: (v: T) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.recordings }),
  })
}

export function useKeepRecording() {
  return useRecordingMutation(({ id, keep }: { id: string; keep: boolean }) =>
    unwrap(api.PUT("/api/v1/recordings/{id}/keep", { params: { path: { id } }, body: { keep } })),
  )
}

export function useRenameRecording() {
  return useRecordingMutation(({ id, name }: { id: string; name: string }) =>
    unwrap(api.PUT("/api/v1/recordings/{id}/name", { params: { path: { id } }, body: { name } })),
  )
}

export function useShareRecording() {
  return useRecordingMutation(({ id, share }: { id: string; share: boolean }) =>
    share
      ? unwrap(api.POST("/api/v1/recordings/{id}/share", { params: { path: { id } } }))
      : unwrap(api.DELETE("/api/v1/recordings/{id}/share", { params: { path: { id } } })),
  )
}

export function useDeleteRecording() {
  return useRecordingMutation((id: string) =>
    unwrap(api.DELETE("/api/v1/recordings/{id}", { params: { path: { id } } })),
  )
}

export function useSetMarkers(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: RecordingMarker[]) =>
      unwrap(api.PUT("/api/v1/recordings/{id}/markers", { params: { path: { id } }, body: { items } })),
    onMutate: (items) => {
      qc.setQueryData(keys.recording(id), (d: RecordingDetail | undefined) =>
        d ? { ...d, markers: items.toSorted((a, b) => a.t - b.t) } : d,
      )
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.recording(id) }),
  })
}

export function useAddSessionMarker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ provider, id, label }: { provider: string; id: string; label?: string }) =>
      unwrap(
        api.POST("/api/v1/sessions/{provider}/{id}/recording/markers", {
          params: { path: { provider, id } },
          body: { label },
        }),
      ),
    onSuccess: (r) => void qc.invalidateQueries({ queryKey: keys.recording(r.recording) }),
  })
}

export function useSessionRecording() {
  return useRecordingMutation(({ provider, id, on }: { provider: string; id: string; on: boolean }) =>
    on
      ? unwrap(api.POST("/api/v1/sessions/{provider}/{id}/recording", { params: { path: { provider, id } } }))
      : unwrap(api.DELETE("/api/v1/sessions/{provider}/{id}/recording", { params: { path: { provider, id } } })),
  )
}
