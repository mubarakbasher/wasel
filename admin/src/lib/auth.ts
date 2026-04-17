export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

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
