import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Mutations explicitly invalidate affected keys, while session changes
      // clear the whole cache. Keep recent route data warm to avoid duplicate
      // requests when a page remounts or the user moves back and forth.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
