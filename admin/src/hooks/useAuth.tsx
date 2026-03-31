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
    const { accessToken, refreshToken, user: userData } = resp.data;

    if (userData.role !== 'admin') {
      throw new Error('Access denied. Admin privileges required.');
    }

    storeAuth(accessToken, refreshToken, userData);
    setUser(userData);
  }, []);

  const logout = useCallback(() => {
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

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
