"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppHeader, type HeaderUser } from "@/components/app-header";
import { api } from "@/lib/api";
import { clearTokens, isLoggedIn } from "@/lib/auth";

interface DailySessionRow {
  id: string;
  status: string;
  question_count: number;
  answered_count: number;
  created_at: string;
  completed_at: string | null;
}

interface PreviewQuestions {
  patient_id: string;
  questions: string[];
  is_custom: boolean;
  daily_done_today?: boolean;
  has_in_progress_today?: boolean;
  in_progress_session_id?: string | null;
}

export default function DailyHomePage() {
  const router = useRouter();
  const [user, setUser] = useState<HeaderUser | null>(null);
  const [preview, setPreview] = useState<PreviewQuestions | null>(null);
  const [sessions, setSessions] = useState<DailySessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [qRes, sRes] = await Promise.all([
      api.get<PreviewQuestions>("/api/daily-checkin/questions"),
      api.get<DailySessionRow[]>("/api/daily-checkin/sessions"),
    ]);
    setPreview(qRes.data);
    setSessions(sRes.data);
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }
    api
      .get<HeaderUser>("/api/auth/me")
      .then(async (me) => {
        if (
          me.data.role !== "patient" &&
          me.data.role !== "therapist" &&
          me.data.role !== "admin"
        ) {
          router.replace("/dashboard");
          return;
        }
        setUser(me.data);
        await load();
      })
      .catch(() => {
        clearTokens();
        router.replace("/login");
      })
      .finally(() => setLoading(false));
  }, [router, load]);

  async function startOrContinue() {
    setStarting(true);
    setError("");
    try {
      const res = await api.post<{ id: string }>("/api/daily-checkin/sessions");
      router.push(`/daily/${res.data.id}`);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(
        typeof msg === "string" ? msg : "Nie udało się otworzyć sesji Daily."
      );
    } finally {
      setStarting(false);
    }
  }

  const formatWhen = (iso: string) =>
    new Date(iso).toLocaleString("pl-PL", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-slate-400 text-sm">Ładowanie…</p>
      </div>
    );
  }

  const inProgressId =
    preview?.in_progress_session_id ??
    sessions.find((s) => s.status === "in_progress")?.id;
  const showContinue = Boolean(preview?.has_in_progress_today && inProgressId);
  const dailyLocked =
    Boolean(preview?.daily_done_today) && !preview?.has_in_progress_today;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <AppHeader user={user} />
      <main className="max-w-lg mx-auto px-4 py-10 w-full flex-1 space-y-8">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Daily</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Krótka, stała lista pytań od terapeuty (bez czatu z AI). Odpowiadasz kolejno na każde
            pytanie.
          </p>
          {preview && (
            <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
              {preview.is_custom
                ? "Pytania ustawione indywidualnie przez terapeutę."
                : "Domyślny zestaw pytań — terapeuta może przygotować własną listę dla Ciebie."}
            </p>
          )}
          {dailyLocked && (
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900 rounded-lg px-3 py-2 mt-3">
              Dzisiejszy Daily jest już zakończony — drugi raz tego samego dnia nie wypełnisz. Kolejna
              sesja: od następnego dnia (granica dnia według czasu UTC).
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          {showContinue && inProgressId ? (
            <Link
              href={`/daily/${inProgressId}`}
              className="inline-flex justify-center rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium py-3 px-5 transition"
            >
              Kontynuuj rozpoczęty check-in
            </Link>
          ) : dailyLocked ? null : (
            <button
              type="button"
              onClick={startOrContinue}
              disabled={starting}
              className="inline-flex justify-center rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium py-3 px-5 transition"
            >
              {starting ? "Otwieranie…" : "Rozpocznij check-in"}
            </button>
          )}
        </div>

        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
          <h2 className="font-medium text-slate-800 dark:text-slate-100 text-sm mb-3">
            Ostatnie check-iny
          </h2>
          {sessions.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Jeszcze brak zapisanych.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/daily/${s.id}`}
                    className="flex items-center justify-between py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 -mx-2 px-2 rounded-lg transition text-sm"
                  >
                    <span className="text-slate-700 dark:text-slate-200">
                      {s.answered_count}/{s.question_count} odpowiedzi
                      {s.status === "in_progress" && (
                        <span className="ml-2 text-amber-600 dark:text-amber-400 text-xs">
                          w toku
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-slate-400 shrink-0">{formatWhen(s.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
