// Simple auth token service for JWT stored in localStorage
// In production consider more secure storage and refresh handling

const ACCESS_TOKEN_KEY = 'bp_access_token';
const REFRESH_TOKEN_KEY = 'bp_refresh_token';

export type Tokens = {
  access: string;
  refresh?: string;
};

export function setTokens(tokens: Tokens) {
  if (tokens.access) localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access);
  if (tokens.refresh) localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export async function obtainToken(username: string, password: string): Promise<Tokens> {
  const resp = await fetch('/api/auth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!resp.ok) {
    let message = 'Не удалось выполнить вход. Попробуйте ещё раз.';
    try {
      const data = await resp.json();
      const detail = (data && (data.detail || (Array.isArray(data.non_field_errors) ? data.non_field_errors[0] : null))) || '';

      if (resp.status === 401) {
        // Неверный логин или пароль / неактивный аккаунт
        message = 'Неверный логин или пароль.';
      }

      if (typeof detail === 'string' && detail) {
        if (detail.includes('No active account found with the given credentials')) {
          message = 'Неверный логин или пароль.';
        } else {
          // Если бэкенд вернул осмысленное сообщение (в том числе на русском) — покажем его
          message = detail;
        }
      }
    } catch {
      // Если не удалось распарсить JSON, оставляем общее сообщение
    }

    throw new Error(message);
  }
  const data = await resp.json();
  // data shape: { access, refresh }
  setTokens({ access: data.access, refresh: data.refresh });
  return { access: data.access, refresh: data.refresh };
}

export async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  const resp = await fetch('/api/auth/token/refresh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (data.access) {
    setTokens({ access: data.access, refresh });
    return data.access as string;
  }
  return null;
}
