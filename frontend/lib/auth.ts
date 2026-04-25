const ACCESS_KEY = "cognoscere_access_token";
const REFRESH_KEY = "cognoscere_refresh_token";

function clientStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function getAccessToken(): string | null {
  return clientStorage()?.getItem(ACCESS_KEY) ?? null;
}

export function getRefreshToken(): string | null {
  return clientStorage()?.getItem(REFRESH_KEY) ?? null;
}

export function saveTokens(accessToken: string, refreshToken: string): void {
  const s = clientStorage();
  if (!s) return;
  s.setItem(ACCESS_KEY, accessToken);
  s.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens(): void {
  const s = clientStorage();
  if (!s) return;
  s.removeItem(ACCESS_KEY);
  s.removeItem(REFRESH_KEY);
}

export function isLoggedIn(): boolean {
  return Boolean(getAccessToken() ?? getRefreshToken());
}
