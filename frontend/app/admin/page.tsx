"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppHeader, type HeaderUser } from "@/components/app-header";
import { api } from "@/lib/api";
import { clearTokens, isLoggedIn } from "@/lib/auth";

type UserRole = "admin" | "therapist" | "patient";

interface AdminStats {
  total_users: number;
  total_therapists: number;
  total_patients: number;
  total_admins: number;
  total_emotion_sessions: number;
  llm_tokens_input_total: number;
  llm_tokens_output_total: number;
}

interface AdminUserRow {
  id: string;
  email: string;
  role: UserRole;
  first_name: string;
  display_name: string | null;
  llm_token_limit: number;
  llm_tokens_input_total: number;
  llm_tokens_output_total: number;
  emotion_session_count: number;
  created_at: string;
  last_login: string | null;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  therapist: "Terapeuta",
  patient: "Pacjent",
};

export default function AdminPage() {
  const router = useRouter();
  const [headerUser, setHeaderUser] = useState<HeaderUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [error, setError] = useState("");
  const [passwordByUser, setPasswordByUser] = useState<Record<string, string>>({});
  const [limitDraft, setLimitDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    const [s, u] = await Promise.all([
      api.get<AdminStats>("/api/admin/stats"),
      api.get<AdminUserRow[]>("/api/admin/users"),
    ]);
    setStats(s.data);
    setUsers(u.data);
    const limits: Record<string, string> = {};
    for (const row of u.data) limits[row.id] = String(row.llm_token_limit);
    setLimitDraft(limits);
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }
    api
      .get<HeaderUser>("/api/auth/me")
      .then((me) => {
        if (me.data.role !== "admin") {
          router.replace("/dashboard");
          return;
        }
        setHeaderUser(me.data);
        return load();
      })
      .catch(() => {
        clearTokens();
        router.replace("/login");
      })
      .finally(() => setLoading(false));
  }, [router, load]);

  async function patchLimit(userId: string) {
    const raw = limitDraft[userId];
    const n = parseInt(raw ?? "", 10);
    if (Number.isNaN(n) || n < 0) {
      setError("Limit musi być liczbą nieujemną.");
      return;
    }
    setBusyId(userId);
    setError("");
    try {
      await api.patch(`/api/admin/users/${userId}/llm-token-limit`, {
        llm_token_limit: n,
      });
      await load();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(String(msg ?? "Nie udało się zapisać limitu."));
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(userId: string) {
    const pwd = passwordByUser[userId]?.trim() ?? "";
    if (pwd.length < 8) {
      setError("Hasło musi mieć co najmniej 8 znaków.");
      return;
    }
    setBusyId(userId);
    setError("");
    try {
      await api.post(`/api/admin/users/${userId}/reset-password`, {
        new_password: pwd,
      });
      setPasswordByUser((prev) => ({ ...prev, [userId]: "" }));
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(String(msg ?? "Reset hasła nie powiódł się."));
    } finally {
      setBusyId(null);
    }
  }

  async function patchRole(userId: string, role: "therapist" | "patient") {
    setBusyId(userId);
    setError("");
    try {
      await api.patch(`/api/admin/users/${userId}/role`, { role });
      await load();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(String(msg ?? "Zmiana roli nie powiodła się."));
    } finally {
      setBusyId(null);
    }
  }

  if (loading || !headerUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-slate-400 text-sm">Ładowanie panelu…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <div className="border-b border-violet-200/50 dark:border-violet-900/40 bg-violet-50/80 dark:bg-violet-950/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center gap-3 py-2 text-xs text-violet-900 dark:text-violet-200">
          <span className="font-semibold uppercase tracking-wide">Administracja</span>
          <Link href="/dashboard" className="hover:underline ml-auto">
            ← Pulpit (widok użytkownika)
          </Link>
        </div>
      </div>
      <AppHeader user={headerUser} />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8 flex-1 w-full">
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 flex flex-wrap gap-x-4 gap-y-2 items-center text-sm">
          <span className="text-slate-600 dark:text-slate-400">
            Narzędzia na własny użytek (sesja emocjonalna, Daily):
          </span>
          <Link
            href="/daily"
            className="font-medium text-brand-600 dark:text-brand-400 hover:underline"
          >
            Daily
          </Link>
          <Link
            href="/sessions"
            className="font-medium text-brand-600 dark:text-brand-400 hover:underline"
          >
            Moje sesje
          </Link>
          <Link
            href="/session/new"
            className="font-medium text-brand-600 dark:text-brand-400 hover:underline"
          >
            Nowa sesja
          </Link>
        </section>

        {error && (
          <div className="bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-sm rounded-lg px-4 py-3 border border-red-200 dark:border-red-900">
            {error}
          </div>
        )}

        {stats && (
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Użytkownicy" value={stats.total_users} />
            <StatCard label="Sesje emocjonalne" value={stats.total_emotion_sessions} />
            <StatCard
              label="Tokeny wejściowe (suma)"
              value={stats.llm_tokens_input_total.toLocaleString("pl-PL")}
            />
            <StatCard
              label="Tokeny wyjściowe (suma)"
              value={stats.llm_tokens_output_total.toLocaleString("pl-PL")}
            />
            <StatCard label="Terapeuci" value={stats.total_therapists} />
            <StatCard label="Pacjenci" value={stats.total_patients} />
            <StatCard label="Administratorzy" value={stats.total_admins} />
          </section>
        )}

        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm dark:shadow-none">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
            <h2 className="font-semibold text-slate-800 dark:text-slate-100">Użytkownicy</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Limity LLM dotyczą wywołań modelu w sesjach pacjenta (zużycie jest sumowane).
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              <strong className="font-medium text-slate-600 dark:text-slate-300">Daily:</strong> stałą
              listę pytań dla pacjenta ustawia wyłącznie terapeuta — w karcie danego pacjenta, sekcja
              „Daily — check-in” (po zalogowaniu na konto terapeuty).
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Rola</th>
                  <th className="px-4 py-3 font-medium">Sesje</th>
                  <th className="px-4 py-3 font-medium">Tokeny (wej./wyj.)</th>
                  <th className="px-4 py-3 font-medium">Limit LLM</th>
                  <th className="px-4 py-3 font-medium min-w-[280px]">Akcje</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const used = u.llm_tokens_input_total + u.llm_tokens_output_total;
                  const busy = busyId === u.id;
                  return (
                    <tr
                      key={u.id}
                      className="border-b border-slate-50 dark:border-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 text-slate-800 dark:text-slate-200"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800 dark:text-slate-100">{u.email}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {u.display_name ?? u.first_name}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {ROLE_LABELS[u.role]}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{u.emotion_session_count}</td>
                      <td className="px-4 py-3 text-xs tabular-nums text-slate-600 dark:text-slate-400">
                        {u.llm_tokens_input_total.toLocaleString("pl-PL")} /{" "}
                        {u.llm_tokens_output_total.toLocaleString("pl-PL")}
                        <div className="text-slate-400 dark:text-slate-500">
                          suma: {used.toLocaleString("pl-PL")}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min={0}
                          className="w-28 rounded-lg px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                          value={limitDraft[u.id] ?? ""}
                          onChange={(e) =>
                            setLimitDraft((prev) => ({ ...prev, [u.id]: e.target.value }))
                          }
                          disabled={busy}
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => patchLimit(u.id)}
                          className="ml-2 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-50"
                        >
                          Zapisz
                        </button>
                      </td>
                      <td className="px-4 py-3 space-y-2 align-top">
                        {u.role !== "admin" && (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                              Zmień rolę:
                            </span>
                            <button
                              type="button"
                              disabled={busy || u.role === "therapist"}
                              onClick={() => patchRole(u.id, "therapist")}
                              className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              Terapeuta
                            </button>
                            <button
                              type="button"
                              disabled={busy || u.role === "patient"}
                              onClick={() => patchRole(u.id, "patient")}
                              className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              Pacjent
                            </button>
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="password"
                            autoComplete="new-password"
                            placeholder="Nowe hasło (min. 8)"
                            className="flex-1 min-w-[140px] rounded-lg px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                            value={passwordByUser[u.id] ?? ""}
                            onChange={(e) =>
                              setPasswordByUser((prev) => ({ ...prev, [u.id]: e.target.value }))
                            }
                            disabled={busy}
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => resetPassword(u.id)}
                            className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 transition-colors"
                          >
                            Reset hasła
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3 shadow-sm dark:shadow-none">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-lg font-semibold text-slate-800 dark:text-slate-100 tabular-nums mt-1">
        {value}
      </p>
    </div>
  );
}
