import createClient from "openapi-fetch"
import type { components as AgentComponents, paths as AgentPaths } from "./agent"
import type { components, paths } from "./schema"

type Schemas = components["schemas"]
type AgentSchemas = AgentComponents["schemas"]

export type Identity = Schemas["Identity"]
export type ArtifactView = Schemas["ArtifactView"]
export type ArtifactList = Schemas["ArtifactList"]
export type ArtifactsEvent = Schemas["ArtifactsEvent"]
export type UploadsInfo = Schemas["UploadsInfo"]
export type Visibility = NonNullable<ArtifactView["meta"]["visibility"]>
export type ProviderView = Schemas["ProviderView"]
export type SessionView = Schemas["SessionView"]
export type SessionsEvent = Schemas["SessionsEvent"]
export type SessionState = SessionView["state"]
export type Location = Schemas["Location"]
export type SSHInfo = Schemas["SSHInfo"]
export type Computer = Schemas["Computer"]
export type ComputerList = Schemas["ComputerList"]
export type AppDataView = Schemas["AppDataView"]
export type AppDataList = Schemas["AppDataList"]
export type AppDataChoice = Schemas["AppDataChoice"]
export type WebViewView = Schemas["WebViewView"]
export type ErrorDetail = Schemas["ErrorDetail"]
export type Slot = Schemas["Slot"]
export type Display = Schemas["Display"]
export type Maintenance = Schemas["Maintenance"]
export type ProviderInventory = Schemas["ProviderInventory"]
export type InventoryDevice = Schemas["InventoryDevice"]
export type DeviceInfo = Schemas["DeviceInfo"]
export type HostInfo = Schemas["HostInfo"]

export type DevToolsTarget = AgentSchemas["DevToolsTarget"]
export type StatusEvent = AgentSchemas["StatusEvent"]
export type Network = AgentSchemas["Network"]
export type Clipboard = AgentSchemas["Clipboard"]
export type Vibration = AgentSchemas["Vibration"]
export type Screen = AgentSchemas["Screen"]
export type DeviceState = AgentSchemas["DeviceState"]
export type Tunnels = AgentSchemas["Tunnels"]
export type ReverseTunnel = AgentSchemas["ReverseTunnel"]
export type Metrics = AgentSchemas["Metrics"]
export type Temperature = AgentSchemas["Temperature"]
export type DeviceSettings = AgentSchemas["DeviceSettings"]
export type NetworkProfile = NonNullable<DeviceState["networkProfile"]>
export type DeviceAction = AgentPaths["/v1/device/actions/{action}"]["post"]["parameters"]["path"]["action"]

export const api = createClient<paths>({ baseUrl: "" })

export function sessionBase(provider: string, id: string) {
  return `/s/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`
}

export function agentClient(provider: string, id: string) {
  return createClient<AgentPaths>({ baseUrl: sessionBase(provider, id) })
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message)
  }
}

type Result<T> = { data?: T; error?: unknown; response: Response }

export async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await request
  if (error !== undefined || !response.ok) {
    const detail =
      error && typeof error === "object" && "detail" in error && typeof error.detail === "string"
        ? error.detail
        : response.statusText
    const details =
      error && typeof error === "object" && "errors" in error && Array.isArray(error.errors)
        ? (error.errors as ErrorDetail[])
        : []
    throw new ApiError(response.status, detail || `Request failed (${response.status})`, details)
  }
  return data as T
}
