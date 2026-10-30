import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { routeTree } from "./routeTree.gen";

// The site is static and the server runs only one time to prerender, so one client for each page load is enough.
// Queries do not fetch. Firestore snapshots fill the cache. When you leave a list, its items stay in the cache
// for 5 minutes, so the list shows immediately when you go back to it.
const queryClient = new QueryClient();

function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true, Wrap: QueryProvider });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
