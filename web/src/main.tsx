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
import { HomePage } from "@/pages/home"
import { SessionPage } from "@/pages/session"
import { SSHKeysPage } from "@/pages/ssh-keys"

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

const rootRoute = createRootRoute({
  component: () => (
    <AuthGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </AuthGate>
  ),
})

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>): { source?: string; launch?: string; quick?: boolean } => ({
    source: typeof search.source === "string" ? search.source : undefined,
    launch: typeof search.launch === "string" ? search.launch : undefined,
    quick: search.quick === 1 || search.quick === "1" || search.quick === true ? true : undefined,
  }),
  component: HomePage,
})

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/session/$provider/$id",
  component: function Session() {
    const { provider, id } = sessionRoute.useParams()
    return <SessionPage key={`${provider}/${id}`} provider={provider} id={id} />
  },
})

const sshKeysRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ssh",
  validateSearch: (search: Record<string, unknown>): { request?: string } => ({
    request: typeof search.request === "string" ? search.request : undefined,
  }),
  component: SSHKeysPage,
})

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit",
  validateSearch: validateAuditSearch,
  component: AuditPage,
})

const appDataRoute = createRoute({ getParentRoute: () => rootRoute, path: "/app-data", component: AppDataPage })

const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, sessionRoute, sshKeysRoute, auditRoute, appDataRoute]),
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
