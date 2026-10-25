import "./index.css"
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router"
import { ThemeProvider } from "next-themes"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ApiError } from "@/api/client"
import { AppShell } from "@/components/app-shell"
import { AuthGate } from "@/components/auth-gate"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppDataPage } from "@/pages/app-data"
import { AuditPage, validateAuditSearch } from "@/pages/audit"
import { ComputersPage } from "@/pages/computers"
import { HomePage } from "@/pages/home"
import { InventoryPage } from "@/pages/inventory"
import { LaunchPage, validateLaunchSearch } from "@/pages/launch"
import { OpenRecordingPage } from "@/pages/open-recording"
import { RecordingPage } from "@/pages/recording"
import { RecordingsPage } from "@/pages/recordings"
import { SessionPage } from "@/pages/session"

const onUnauthorized = (error: Error) => {
  if (error instanceof ApiError && error.status === 401) void queryClient.invalidateQueries({ queryKey: ["auth"] })
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onUnauthorized }),
  mutationCache: new MutationCache({ onError: onUnauthorized }),
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
})

const rootRoute = createRootRoute({ component: Outlet })

const portalRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_portal",
  component: () => (
    <AuthGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </AuthGate>
  ),
})

const sharedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/r/$token",
  component: function Shared() {
    const { token } = sharedRoute.useParams()
    return (
      <div className="h-dvh">
        <RecordingPage key={token} source={{ kind: "shared", token }} />
      </div>
    )
  },
})

const openRoute = createRoute({ getParentRoute: () => rootRoute, path: "/open", component: OpenRecordingPage })

const homeRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>): { source?: string; launch?: string; quick?: boolean } => ({
    source: typeof search.source === "string" ? search.source : undefined,
    launch: typeof search.launch === "string" ? search.launch : undefined,
    quick: search.quick === 1 || search.quick === "1" || search.quick === true ? true : undefined,
  }),
  component: HomePage,
})

const appRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/apps/$pkg",
  component: function App() {
    const { pkg } = appRoute.useParams()
    return <HomePage key={pkg} pkg={pkg} />
  },
})

const sessionRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/session/$provider/$id",
  component: function Session() {
    const { provider, id } = sessionRoute.useParams()
    return <SessionPage key={`${provider}/${id}`} provider={provider} id={id} />
  },
})

const launchRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/launch",
  validateSearch: validateLaunchSearch,
  component: function Launch() {
    const search = launchRoute.useSearch()
    return <LaunchPage key={JSON.stringify(search)} {...search} />
  },
})

const computersRoute = createRoute({ getParentRoute: () => portalRoute, path: "/computers", component: ComputersPage })

const auditRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/audit",
  validateSearch: validateAuditSearch,
  component: AuditPage,
})

const inventoryRoute = createRoute({ getParentRoute: () => portalRoute, path: "/inventory", component: InventoryPage })

const appDataRoute = createRoute({ getParentRoute: () => portalRoute, path: "/app-data", component: AppDataPage })

const recordingsRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/recordings",
  component: RecordingsPage,
})

const recordingRoute = createRoute({
  getParentRoute: () => portalRoute,
  path: "/recordings/$id",
  component: function Recording() {
    const { id } = recordingRoute.useParams()
    return <RecordingPage key={id} source={{ kind: "own", id }} />
  },
})

const router = createRouter({
  routeTree: rootRoute.addChildren([
    portalRoute.addChildren([
      homeRoute,
      appRoute,
      launchRoute,
      sessionRoute,
      computersRoute,
      auditRoute,
      inventoryRoute,
      appDataRoute,
      recordingsRoute,
      recordingRoute,
    ]),
    sharedRoute,
    openRoute,
  ]),
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster richColors />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
