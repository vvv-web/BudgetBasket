import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from '../utils/session';

describe('api client', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    localStorage.clear();
  });

  it('uses VITE_API_URL as axios baseURL', async () => {
    vi.stubEnv('VITE_API_URL', '/api');
    const { api } = await import('./client');
    expect(api.defaults.baseURL).toBe('/api');
  });

  it('clears session and redirects to /login on 401 (not login endpoint)', async () => {
    vi.stubEnv('VITE_API_URL', '/api');
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname: '/requests/abc', assign } as unknown as Location);

    localStorage.setItem(AUTH_TOKEN_KEY, 'old-token');
    localStorage.setItem(AUTH_USER_KEY, '{"id":"1"}');

    const { api } = await import('./client');
    const mock = new MockAdapter(api);
    mock.onGet('/dashboard').reply(401, { detail: 'Требуется авторизация' });

    await expect(api.get('/dashboard')).rejects.toBeTruthy();

    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();
    expect(assign).toHaveBeenCalledWith('/login');
    mock.restore();
  });

  it('does not redirect on failed /auth/login 401', async () => {
    vi.stubEnv('VITE_API_URL', '/api');
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname: '/login', assign } as unknown as Location);

    localStorage.setItem(AUTH_TOKEN_KEY, 'attempt-token');

    const { api } = await import('./client');
    const mock = new MockAdapter(api);
    mock.onPost('/auth/login').reply(401, { detail: 'Неверный логин или пароль' });

    await expect(api.post('/auth/login', { login: 'x', password: 'y' })).rejects.toBeTruthy();

    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('attempt-token');
    expect(assign).not.toHaveBeenCalled();
    mock.restore();
  });
});
