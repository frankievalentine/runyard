import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiError } from "./api.ts";
import { sessionQuery } from "./lib/queries.ts";
import { applyTheme } from "./lib/theme.ts";
import { routeTree } from "./routeTree.gen.ts";
import "./styles.css";

applyTheme();

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // A 401 means the session ended (expired, revoked, user removed): re-check it and let the guards redirect.
    onError: (error, query) => {
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        query.queryHash !== JSON.stringify(sessionQuery.queryKey)
      ) {
        queryClient.removeQueries({ queryKey: sessionQuery.queryKey });
        void router.invalidate();
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
