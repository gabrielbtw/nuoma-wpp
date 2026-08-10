import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { useMemo, type ReactNode } from "react";
import superjson from "superjson";

import { trpc } from "./trpc.js";
import { API_URL } from "./api-url.js";
import { csrfFromCookie } from "./csrf.js";

export function TrpcProvider({ children }: { children: ReactNode }) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
    [],
  );

  const trpcClient = useMemo(
    () =>
      trpc.createClient({
        links: [
          splitLink({
            condition(operation) {
              return (
                operation.path === "chatbots.listRules" ||
                operation.path === "chatbots.summarizeVariantEvents"
              );
            },
            true: httpLink({ ...trpcHttpOptions() }),
            false: httpBatchLink({
              ...trpcHttpOptions(),
              // Keep comma-joined tRPC paths small enough for the Fastify route matcher.
              maxItems: 4,
            }),
          }),
        ],
      }),
    [],
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}

function trpcHttpOptions() {
  return {
    url: `${API_URL}/trpc`,
    transformer: superjson,
    fetch(input: RequestInfo | URL, init?: RequestInit) {
      const headers = new Headers(init?.headers);
      const csrf = csrfFromCookie();
      if (csrf) headers.set("x-csrf-token", csrf);
      return fetch(input, {
        ...init,
        credentials: "include",
        headers,
      });
    },
  };
}
