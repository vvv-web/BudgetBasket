function webSocketUrl(path: string, token: string) {
  const apiUrl = new URL(import.meta.env.VITE_API_URL || 'http://localhost:8000', window.location.origin);
  apiUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  apiUrl.pathname = `${apiUrl.pathname.replace(/\/$/, '')}${path}`;
  apiUrl.searchParams.set('token', token);
  return apiUrl.toString();
}

export function requestChatWebSocketUrl(requestId: string, token: string) {
  return webSocketUrl(`/ws/requests/${encodeURIComponent(requestId)}/chat`, token);
}

export function chatNotificationsWebSocketUrl(token: string) {
  return webSocketUrl('/ws/chat-notifications', token);
}
