import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { getAccessToken, getRefreshToken, storeAuth, clearAuth, getStoredUser } from './auth';

const apiBaseUrl = import.meta.env.VITE_API_URL || '/api/v1';

const api = axios.create({ baseURL: apiBaseUrl });

/**
 * Derive the allowlisted API host from the configured base URL.
 * Returns null when the base URL is relative (dev mode — same-origin).
 */
function getAllowedApiHost(): string | null {
  if (!apiBaseUrl.startsWith('http')) return null;
  try {
    return new URL(apiBaseUrl).host;
  } catch {
    return null;
  }
}

/**
 * Resolve a backend-relative asset path (e.g. /uploads/receipts/xxx.jpg) to a URL
 * the browser can fetch. In dev, vite proxies /uploads → backend. In prod the admin
 * is served from a different origin than the API, so we prefix with the API origin
 * derived from VITE_API_URL.
 *
 * Absolute URLs are only returned if their host matches the API origin — this
 * prevents operator-supplied or attacker-supplied external URLs (e.g. phishing
 * receipt links) from being rendered by the admin.
 */
export function resolveAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) {
    try {
      const parsed = new URL(path);
      const allowedHost = getAllowedApiHost();
      // Dev mode (relative base URL): fall back to same-origin — only allow
      // URLs whose host matches the current window origin.
      if (!allowedHost) {
        if (typeof window !== 'undefined' && parsed.host === window.location.host) {
          return path;
        }
        return null;
      }
      return parsed.host === allowedHost ? path : null;
    } catch {
      return null;
    }
  }
  if (apiBaseUrl.startsWith('http')) {
    const origin = apiBaseUrl.replace(/\/api\/v1\/?$/, '');
    return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
  }
  return path;
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ---------------------------------------------------------------------------
// Single-flight refresh — mirrors the mobile Dio interceptor (api_client.dart)
// ---------------------------------------------------------------------------
//
// On a 401:
//   - If the failing request is /auth/refresh itself, or has already been
//     retried, bail out (clear tokens + redirect to login).
//   - If another refresh is in flight, queue this request's retry behind a
//     promise so it picks up the new token once the single refresh resolves.
//   - Otherwise, kick off POST /auth/refresh. On success: persist the new
//     token pair, drain the queue, retry the original request once. On
//     failure: reject the queue, clear tokens, redirect to /login.
//
// The refresh request uses a bare axios instance so it cannot trigger the
// interceptor recursively, but we also guard by URL just in case.

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

function subscribeToRefresh(cb: (token: string | null) => void): void {
  refreshQueue.push(cb);
}

function onRefreshed(token: string | null): void {
  refreshQueue.forEach((cb) => cb(token));
  refreshQueue = [];
}

function isRefreshCall(config: AxiosRequestConfig | undefined): boolean {
  const url = config?.url ?? '';
  return url.includes('/auth/refresh');
}

type RetriableConfig = AxiosRequestConfig & { _retry?: boolean };

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    if (status !== 401 || !original || isRefreshCall(original) || original._retry) {
      if (status === 401) {
        clearAuth();
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
      return Promise.reject(error);
    }

    original._retry = true;

    // Queue behind an in-flight refresh.
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        subscribeToRefresh((newToken) => {
          if (!newToken) {
            reject(error);
            return;
          }
          original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${newToken}` };
          api(original).then(resolve).catch(reject);
        });
      });
    }

    isRefreshing = true;
    try {
      const refreshToken = getRefreshToken();
      if (!refreshToken) throw new Error('No refresh token available');

      // Bare axios — no interceptor, so a 401 here won't recurse.
      const resp = await axios.post(
        `${apiBaseUrl}/auth/refresh`,
        { refreshToken },
        { headers: { 'Content-Type': 'application/json' } },
      );

      const newAccessToken = resp.data?.data?.accessToken as string | undefined;
      const newRefreshToken = resp.data?.data?.refreshToken as string | undefined;
      if (!newAccessToken || !newRefreshToken) {
        throw new Error('Malformed refresh response');
      }

      // Preserve any existing stored user record so the session stays intact.
      const storedUser = getStoredUser();
      if (storedUser) {
        storeAuth(newAccessToken, newRefreshToken, storedUser);
      } else {
        localStorage.setItem('accessToken', newAccessToken);
        localStorage.setItem('refreshToken', newRefreshToken);
      }

      onRefreshed(newAccessToken);

      original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${newAccessToken}` };
      return api(original);
    } catch (refreshError) {
      onRefreshed(null);
      clearAuth();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

export default api;
