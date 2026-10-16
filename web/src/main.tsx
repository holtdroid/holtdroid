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
import { HomePage } from "@/pages/home"
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

const rootRoute = createRootRoute({
  component: () => (
    <AuthGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </AuthGate>
  ),
})

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage })

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/session/$provider/$id",
  component: function Session() {
    const { provider, id } = sessionRoute.useParams()
    return <SessionPage key={`${provider}/${id}`} provider={provider} id={id} />
  },
})

const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, sessionRoute]) })

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
