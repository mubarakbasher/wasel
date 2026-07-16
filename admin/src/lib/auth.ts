export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

// Auth persistence for the admin SPA.
//
// The refresh token is NOT stored here — it lives in an HttpOnly, Secure,
// SameSite cookie (Path=/api/v1/auth) issued by the backend, so no script
// running in this origin can read it. Only the short-lived access token and the
// user record are kept in localStorage; the access token is sent as a Bearer
// header and rotated via POST /auth/refresh (empty body, cookie-authenticated).
//
// Any refreshToken key left over from the pre-cookie build is stale and is
// purged on init (below) and on every login, so it never lingers.
localStorage.removeItem('refreshToken');

export function getStoredUser(): User | null {
  const data = localStorage.getItem('user');
  return data ? JSON.parse(data) : null;
}

export function getAccessToken(): string | null {
  return localStorage.getItem('accessToken');
}

export function isAuthenticated(): boolean {
  return !!getAccessToken() && !!getStoredUser();
}

export function storeAuth(accessToken: string, user: User): void {
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('user', JSON.stringify(user));
  // Belt-and-braces: drop any stale pre-cookie refresh token on login.
  localStorage.removeItem('refreshToken');
}

export function clearAuth(): void {
  localStorage.clear();
}
