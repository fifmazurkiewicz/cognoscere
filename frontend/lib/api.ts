import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";

import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "./auth";

const baseURL = process.env.NEXT_PUBLIC_API_URL ?? "";

type ConfigWithRetry = InternalAxiosRequestConfig & { _retry?: boolean };

export const api = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
});

let refreshPromise: Promise<string> | null = null;

function isAuthPath(url: string | undefined): boolean {
  if (!url) return false;
  return (
    url.includes("/api/auth/login") ||
    url.includes("/api/auth/register") ||
    url.includes("/api/auth/refresh")
  );
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as ConfigWithRetry | undefined;
    if (!original || isAuthPath(original.url) || err.response?.status !== 401) {
      return Promise.reject(err);
    }

    if (original._retry) {
      return Promise.reject(err);
    }
    original._retry = true;

    const refresh = getRefreshToken();
    if (!refresh) {
      clearTokens();
      return Promise.reject(err);
    }

    if (!refreshPromise) {
      refreshPromise = (async () => {
        const { data } = await axios.post<{
          access_token: string;
          refresh_token: string;
        }>(`${baseURL}/api/auth/refresh`, { refresh_token: refresh }, { headers: { "Content-Type": "application/json" } });
        saveTokens(data.access_token, data.refresh_token);
        return data.access_token;
      })().finally(() => {
        refreshPromise = null;
      });
    }

    try {
      const access = await refreshPromise;
      if (original.headers) {
        original.headers.Authorization = `Bearer ${access}`;
      }
      return api(original);
    } catch {
      clearTokens();
      return Promise.reject(err);
    }
  }
);
