import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://budgetbasket.acom-offer-desk.ru';

describe('websocket urls', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses /api/ws when VITE_API_URL=/api', async () => {
    vi.stubEnv('VITE_API_URL', '/api');
    vi.stubGlobal('location', { origin: ORIGIN } as Location);

    const { requestChatWebSocketUrl, chatNotificationsWebSocketUrl } = await import('./websocket');

    const chatUrl = new URL(requestChatWebSocketUrl('req-uuid', 'tok-1'));
    expect(chatUrl.hostname).toBe('budgetbasket.acom-offer-desk.ru');
    expect(chatUrl.protocol).toBe('wss:');
    expect(chatUrl.pathname).toBe('/api/ws/requests/req-uuid/chat');
    expect(chatUrl.searchParams.get('token')).toBe('tok-1');

    const inboxUrl = new URL(chatNotificationsWebSocketUrl('tok-2'));
    expect(inboxUrl.pathname).toBe('/api/ws/chat-notifications');
    expect(inboxUrl.searchParams.get('token')).toBe('tok-2');
  });

  it('keeps localhost backend path when VITE_API_URL is absolute', async () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:8000');
    vi.stubGlobal('location', { origin: 'http://localhost:5173' } as Location);

    const { requestChatWebSocketUrl } = await import('./websocket');
    const chatUrl = new URL(requestChatWebSocketUrl('abc', 't'));
    expect(chatUrl.host).toBe('localhost:8000');
    expect(chatUrl.pathname).toBe('/ws/requests/abc/chat');
  });
});
