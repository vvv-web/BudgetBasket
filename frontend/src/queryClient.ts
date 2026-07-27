import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Avoid flashing stale cross-user data; refetch on mount after cache clear.
      staleTime: 0,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
