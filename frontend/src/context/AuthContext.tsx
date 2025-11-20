import React, { createContext, useContext, useEffect, useState } from 'react';
import { authApi, UserMe } from '../services/api';
import { getAccessToken, clearTokens } from '../services/auth';

export type AuthState = {
  user: UserMe | null;
  loading: boolean;
  error: string | null;
};

export type AuthContextValue = AuthState & {
  setUser: (user: UserMe | null) => void;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserMe | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadMe = async () => {
    const token = getAccessToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const me = await authApi.me();
      setUser(me);
    } catch (e: any) {
      console.error('Failed to load me', e);
      setUser(null);
      // если токен невалиден — очистим
      clearTokens();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMe();
  }, []);

  const logout = () => {
    clearTokens();
    setUser(null);
  };

  const value: AuthContextValue = {
    user,
    loading,
    error,
    setUser,
    logout,
    refreshMe: loadMe,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
