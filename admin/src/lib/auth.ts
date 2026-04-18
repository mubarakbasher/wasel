export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

// SECURITY NOTE: Refresh tokens live in localStorage which is accessible to any
// script executing in this origin. The risk is mitigated by:
//   (1) strict CSP in nginx.conf (no inline/remote JS, no data: URIs in scripts),
//   (2) the React codebase avoids dangerouslySetInnerHTML entirely,
//   (3) receipt/asset URLs pass through resolveAssetUrl allowlist.
// TODO(future hardening): migrate refresh token to HttpOnly+Secure+SameSite=Strict
// cookie and keep access token in memory only. Requires backend cookie-issuance
// changes — cross-stack, tracked for a separate follow-up. See RUNBOOKS.md.
export function getStoredUser(): User | null {
  const data = localStorage.getItem('user');
  return data ? JSON.parse(data) : null;
}

export function getAccessToken(): string | null {
  return localStorage.getItem('accessToken');
}

export function getRefreshToken(): string | null {
  return localStorage.getItem('refreshToken');
}

export function isAuthenticated(): boolean {
  return !!getAccessToken() && !!getStoredUser();
}

export function storeAuth(accessToken: string, refreshToken: string, user: User): void {
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', refreshToken);
  localStorage.setItem('user', JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.clear();
}
