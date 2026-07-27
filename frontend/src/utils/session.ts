import { queryClient } from '../queryClient';

export const AUTH_TOKEN_KEY = 'budgetbasket_token';
export const AUTH_USER_KEY = 'budgetbasket_user';

const LAST_CHAT_PREFIX = 'budgetbasket_last_chat_';

function clearBudgetBasketCookies() {
  if (typeof document === 'undefined') return;
  const cookies = document.cookie ? document.cookie.split(';') : [];
  for (const cookie of cookies) {
    const name = cookie.split('=')[0]?.trim();
    if (!name?.startsWith('budgetbasket')) continue;
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  }
}

function clearUserLocalStorage() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);

  const keysToRemove: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(LAST_CHAT_PREFIX)) keysToRemove.push(key);
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

/**
 * Clears auth credentials, chat prefs, cookies and the in-memory React Query cache.
 * Call on logout, failed /auth/me, and before accepting a new login so prior-user
 * snapshots (lists, request details, approval graph) cannot flash into the next session.
 */
export function clearUserSession() {
  clearUserLocalStorage();
  clearBudgetBasketCookies();
  try {
    sessionStorage.clear();
  } catch {
    // Ignore quota / privacy mode restrictions.
  }
  queryClient.clear();
  queryClient.getMutationCache().clear();
}
