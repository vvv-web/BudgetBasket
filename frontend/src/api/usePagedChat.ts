import { useQuery, type QueryKey } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from './client';

type Message = { id: string; created_at: string };

export function usePagedChat<T extends { messages: Message[] }>({ queryKey, url, enabled }: { queryKey: QueryKey; url: string; enabled: boolean }) {
  const [older, setOlder] = useState<{ url: string; messages: Message[]; cursor: string | null } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const scrollAnchor = useRef<{ element: HTMLElement; height: number } | null>(null);
  const recent = useRef<{ url: string; messages: Message[] }>({ url, messages: [] });
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => (await api.get<T & { next_cursor?: string | null }>(url, { params: { page_size: 50 }, signal })).data,
    enabled,
    retry: false,
  });
  useEffect(() => {
    setOlder(null);
    setLoadingOlder(false);
    setOlderError(false);
    return () => { controller.current?.abort(); scrollAnchor.current = null; };
  }, [url]);
  const currentOlder = older?.url === url ? older : null;
  const cursor = currentOlder ? currentOlder.cursor : query.data?.next_cursor;
  const data = useMemo(() => {
    if (!query.data) return undefined;
    const messages = new Map([...(recent.current.url === url ? recent.current.messages : []), ...currentOlder?.messages || [], ...query.data.messages].map((message) => [message.id, message]));
    recent.current = { url, messages: [...messages.values()] };
    return { ...query.data, messages: [...messages.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)) } as T;
  }, [query.data, currentOlder, url]);
  useLayoutEffect(() => {
    const anchor = scrollAnchor.current;
    if (anchor && !loadingOlder) {
      anchor.element.scrollTop += anchor.element.scrollHeight - anchor.height;
      scrollAnchor.current = null;
    }
  }, [data, loadingOlder]);
  const loadOlder = async (element?: HTMLElement | null) => {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(false);
    const request = new AbortController();
    controller.current = request;
    scrollAnchor.current = element ? { element, height: element.scrollHeight } : null;
    try {
      const response = await api.get<T & { next_cursor: string | null }>(url, { params: { page_size: 50, before: cursor }, signal: request.signal });
      setOlder((previous) => ({ url, messages: [...response.data.messages, ...(previous?.url === url ? previous.messages : [])], cursor: response.data.next_cursor }));
    } catch { if (!request.signal.aborted) setOlderError(true); }
    finally { if (!request.signal.aborted) setLoadingOlder(false); }
  };
  return { ...query, data, hasOlder: Boolean(cursor), loadOlder, loadingOlder, olderError };
}
