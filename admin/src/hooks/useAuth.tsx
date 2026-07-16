import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { type User, getStoredUser, storeAuth, clearAuth, isAuthenticated } from '../lib/auth';
import api from '../lib/api';

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
    const { accessToken, user: userData } = resp.data;

    if (userData.role !== 'admin') {
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
