import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: false,
      },
      // Saving creates a new immutable snapshot; retries could create duplicates.
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();
