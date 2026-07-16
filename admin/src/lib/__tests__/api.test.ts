import { describe, it, expect, vi, afterEach } from 'vitest';
import axios, {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import api from '../api';
import { storeAuth } from '../auth';

// Capture the real adapter so each test can swap in a fake transport and then
// put things back — the api instance is a module singleton shared across tests.
const originalAdapter = api.defaults.adapter;

afterEach(() => {
  vi.restoreAllMocks();
  api.defaults.adapter = originalAdapter;
  localStorage.clear();
});

describe('api single-flight refresh interceptor', () => {
  it('refreshes with an empty body + credentials, then retries the original request', async () => {
    storeAuth('old-access', { id: 'u1', name: 'Admin', email: 'a@wasel.app', role: 'admin' });

    // The bare axios.post used by the refresh path — cookie carries the token,
    // so the body is empty and only an access token comes back.
    const postSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { data: { accessToken: 'new-access' } } } as unknown as AxiosResponse);

    // Fake transport: first hit 401s (expired access token), the retry succeeds.
    let calls = 0;
    const adapter: AxiosAdapter = async (config) => {
      calls += 1;
      if (calls === 1) {
        throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, {}, {
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          config,
          data: { success: false },
        } as unknown as AxiosResponse);
      }
      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
        data: { success: true, data: { ok: true } },
      } as unknown as AxiosResponse;
    };
    api.defaults.adapter = adapter;

    const res = await api.get('/protected/thing');

    // Original request replayed after the refresh resolved.
    expect(calls).toBe(2);
    expect(res.data).toEqual({ success: true, data: { ok: true } });

    // Refresh posted an EMPTY body with credentials + the X-Client header.
    expect(postSpy).toHaveBeenCalledTimes(1);
    const [url, body, config] = postSpy.mock.calls[0];
    expect(url).toBe('/api/v1/auth/refresh');
    expect(body).toEqual({});
    expect(config).toMatchObject({
      withCredentials: true,
      headers: { 'X-Client': 'admin' },
    });

    // Rotated access token persisted; no refreshToken key is ever written.
    expect(localStorage.getItem('accessToken')).toBe('new-access');
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });

  it('sends withCredentials + X-Client: admin on every request', async () => {
    let seen: InternalAxiosRequestConfig | undefined;
    const adapter: AxiosAdapter = async (config) => {
      seen = config;
      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
        data: {},
      } as unknown as AxiosResponse;
    };
    api.defaults.adapter = adapter;

    await api.get('/anything');

    expect(seen?.withCredentials).toBe(true);
    expect(seen?.headers?.['X-Client']).toBe('admin');
  });
});
