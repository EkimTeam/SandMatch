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
    const errText = await resp.text();
    throw new Error(errText || 'Failed to obtain token');
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
