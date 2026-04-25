"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppHeader, type HeaderUser } from "@/components/app-header";
import { api } from "@/lib/api";
import { clearTokens, isLoggedIn } from "@/lib/auth";

function apiDetail(err: unknown): string {
  if (!err || typeof err !== "object" || !("response" in err)) return "";
  const d = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0] && typeof d[0] === "object" && "msg" in d[0]) {
    return String((d[0] as { msg: string }).msg);
  }
  return "";
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<HeaderUser | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const [deletePw, setDeletePw] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [delErr, setDelErr] = useState("");
  const [delBusy, setDelBusy] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }
    api
      .get<HeaderUser>("/api/auth/me")
      .then((res) => setUser(res.data))
      .catch(() => {
        clearTokens();
        router.replace("/login");
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwErr("");
    setPwMsg("");
    if (newPw !== newPw2) {
      setPwErr("Nowe hasła muszą być takie same.");
      return;
    }
    setPwBusy(true);
    try {
      await api.post("/api/auth/change-password", {
        current_password: currentPw,
        new_password: newPw,
      });
      setPwMsg("Hasło zostało zmienione.");
      setCurrentPw("");
      setNewPw("");
      setNewPw2("");
    } catch (err: unknown) {
      setPwErr(apiDetail(err) || "Nie udało się zmienić hasła.");
    } finally {
      setPwBusy(false);
    }
  }

  async function handleDeleteAccount(e: React.FormEvent) {
    e.preventDefault();
    setDelErr("");
    if (deleteConfirm.trim().toUpperCase() !== "USUŃ") {
      setDelErr('Wpisz dokładnie USUŃ, aby potwierdzić.');
      return;
    }
    setDelBusy(true);
    try {
      await api.post("/api/auth/delete-account", { password: deletePw });
      clearTokens();
      router.replace("/login");
    } catch (err: unknown) {
      setDelErr(apiDetail(err) || "Nie udało się usunąć konta.");
    } finally {
      setDelBusy(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-slate-400 text-sm">Ładowanie…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <AppHeader user={user} />
      <main className="max-w-lg mx-auto px-4 sm:px-6 py-8 w-full space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            Ustawienia konta
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{user.email}</p>
        </div>

        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">Zmiana hasła</h2>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Obecne hasło
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                required
                className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-950 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Nowe hasło (min. 8 znaków)
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                required
                minLength={8}
                className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-950 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Powtórz nowe hasło
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={newPw2}
                onChange={(e) => setNewPw2(e.target.value)}
                required
                minLength={8}
                className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-950 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            {pwErr && <p className="text-sm text-red-600 dark:text-red-400">{pwErr}</p>}
            {pwMsg && <p className="text-sm text-green-600 dark:text-green-400">{pwMsg}</p>}
            <button
              type="submit"
              disabled={pwBusy}
              className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              {pwBusy ? "Zapisywanie…" : "Zmień hasło"}
            </button>
          </form>
        </section>

        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-red-200 dark:border-red-900/50 p-6 space-y-4">
          <h2 className="font-semibold text-red-800 dark:text-red-300">Usunięcie konta</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Konto zostanie dezaktywowane. Operacji nie można cofnąć z poziomu aplikacji.
          </p>
          <form onSubmit={handleDeleteAccount} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Potwierdź hasłem
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={deletePw}
                onChange={(e) => setDeletePw(e.target.value)}
                required
                className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-950 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Wpisz <strong>USUŃ</strong> (wielkimi literami)
              </label>
              <input
                type="text"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                required
                className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-950 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            {delErr && <p className="text-sm text-red-600 dark:text-red-400">{delErr}</p>}
            <button
              type="submit"
              disabled={delBusy}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              {delBusy ? "Usuwanie…" : "Trwale usuń konto"}
            </button>
          </form>
        </section>

        <p className="text-center text-sm">
          <Link href="/dashboard" className="text-brand-600 dark:text-brand-400 hover:underline">
            ← Wróć do panelu
          </Link>
        </p>
      </main>
    </div>
  );
}
