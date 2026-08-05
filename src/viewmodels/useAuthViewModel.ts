import { useState, useCallback } from 'react';
import { AuthState, LoginCredentials, User } from '../models/User';
import { loginApi, setAuthToken, setRefreshToken } from '../services/focusApi';
import { getFcmToken } from '../services/fcmService';

interface LoginResult {
  user: User;
  token: string;
}

interface AuthViewModel extends AuthState {
  loading: boolean;
  error: string | null;
  login: (credentials: LoginCredentials) => Promise<LoginResult | null>;
  logout: () => void;
  clearError: () => void;
}

const humaniseLoginError = (err: any): string => {
  const status: number | undefined = err?.response?.status;
  const code: string =
    (err?.response?.data?.error?.messageKey ??
      err?.response?.data?.error?.code ??
      err?.response?.data?.message ??
      err?.message ??
      ''
    ).toLowerCase();

  if (!err?.response) {
    return 'Unable to connect. Please check your internet connection.';
  }
  if (status === 401 || status === 403 || status === 422) {
    return 'Invalid email or incorrect password.';
  }
  if (status === 404) {
    return 'No account found with that email address.';
  }
  if (status === 429) {
    return 'Too many login attempts. Please try again later.';
  }
  if (
    code.includes('invalid') || code.includes('incorrect') ||
    code.includes('wrong') || code.includes('credential') ||
    code.includes('password') || code.includes('authentication') ||
    code.includes('unauthor') || code.includes('mismatch')
  ) {
    return 'Invalid email or incorrect password.';
  }
  if (
    code.includes('not_found') || code.includes('not found') ||
    code.includes('no_user') || code.includes('user_not')
  ) {
    return 'No account found with that email address.';
  }
  if (code.includes('locked') || code.includes('disabled') || code.includes('suspended')) {
    return 'This account has been disabled. Please contact support.';
  }
  if (code.includes('rate') || code.includes('limit')) {
    return 'Too many login attempts. Please try again later.';
  }
  return 'Login failed. Please try again.';
};

export const useAuthViewModel = (): AuthViewModel => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(
    async (credentials: LoginCredentials): Promise<LoginResult | null> => {
      setLoading(true);
      setError(null);
      try {
        const fcmToken = await getFcmToken();
        const result = await loginApi(credentials.email, credentials.password, fcmToken);
        const mappedUser: User = {
          id: String(result.user.id),
          name: result.user.name,
          email: result.user.email ?? '',
          role: ((result.user.role ?? 'admin').toLowerCase() as User['role']),
          branch: result.user.branch,
        };
        setAuthToken(result.token);
        if (result.refreshToken) {
          setRefreshToken(result.refreshToken, result.expiresIn);
        }
        setUser(mappedUser);
        setToken(result.token);
        return { user: mappedUser, token: result.token };
      } catch (err: any) {
        setError(humaniseLoginError(err));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    setToken(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    user,
    token,
    isAuthenticated: !!token,
    loading,
    error,
    login,
    logout,
    clearError,
  };
};
