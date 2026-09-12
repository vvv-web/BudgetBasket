import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { api } from './client';

type CursorPage<T> = { items: T[]; next_cursor: string | null };

export function usePagedCursor<T>(queryKey: QueryKey, url: string, enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam, signal }) => (await api.get<CursorPage<T>>(url, {
      params: { page_size: 50, ...(pageParam ? { before: pageParam } : {}) },
      signal,
    })).data,
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor || undefined,
    enabled,
  });
  return {
    ...query,
    items: query.data?.pages.flatMap((page) => page.items) || [],
  };
}
