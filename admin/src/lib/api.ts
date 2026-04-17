import axios from 'axios';

const apiBaseUrl = import.meta.env.VITE_API_URL || '/api/v1';

const api = axios.create({ baseURL: apiBaseUrl });

/**
 * Resolve a backend-relative asset path (e.g. /uploads/receipts/xxx.jpg) to a URL
 * the browser can fetch. In dev, vite proxies /uploads → backend. In prod the admin
 * is served from a different origin than the API, so we prefix with the API origin
 * derived from VITE_API_URL.
 */
export function resolveAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  if (apiBaseUrl.startsWith('http')) {
    const origin = apiBaseUrl.replace(/\/api\/v1\/?$/, '');
    return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
  }
  return path;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.clear();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default api;
