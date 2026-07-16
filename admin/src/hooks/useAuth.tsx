import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import axios from 'axios';
import { type User, getStoredUser, storeAuth, clearAuth, isAuthenticated } from '../lib/auth';
import api, { apiBaseUrl } from '../lib/api';

interface AuthContextType {
  user: User | null;
  isLoggedIn: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getStoredUser);

  const login = useCallback(async (email: string, password: string) => {
    const { data: resp } = await api.post('/auth/login', { email, password });
    const { accessToken, refreshToken, user: userData } = resp.data;

    if (userData.role !== 'admin') {
      // Non-admin sign-in: the backend can't yet know this is a rejected admin
      // session, so it issues the legacy body token pair (no HttpOnly cookie)
      // instead. That refresh token would otherwise live server-side for 7
      // days even though we deny the session client-side right below — revoke
      // it best-effort before throwing. Use a bare axios call (not the `api`
      // instance): there's no access token in storage yet to attach, and this
      // must never touch localStorage or the refresh-retry machinery.
      try {
        await axios.post(`${apiBaseUrl}/auth/logout`, { refreshToken });
      } catch {
        // ignore — the thrown error below is what the caller sees regardless
      }
      throw new Error('Access denied. Admin privileges required.');
    }

    // No refresh token in the body — the backend set it as an HttpOnly cookie.
    storeAuth(accessToken, userData);
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    // Best-effort server-side revocation + cookie clear; never block local
    // teardown on it (network/500/expired session must still log the user out).
    try {
      await api.post('/auth/logout', {});
    } catch {
      // ignore — always clear local state below
    }
    clearAuth();
    setUser(null);
    window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoggedIn: isAuthenticated(), login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is colocated with its provider; this affects Fast Refresh only, not correctness
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
