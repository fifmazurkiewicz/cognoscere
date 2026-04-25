"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppHeader, type HeaderUser } from "@/components/app-header";
import { api } from "@/lib/api";
import { clearTokens, isLoggedIn } from "@/lib/auth";

interface SessionDetail {
  id: string;
  questions: string[];
  answers: string[];
  current_index: number;
  status: string;
  created_at: string;
  completed_at: string | null;
}

export default function DailySessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [user, setUser] = useState<HeaderUser | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }

    async function run() {
      try {
        const me = await api.get<HeaderUser>("/api/auth/me");
        if (
          me.data.role !== "patient" &&
          me.data.role !== "therapist" &&
          me.data.role !== "admin"
        ) {
          router.replace("/dashboard");
          return;
        }
        setUser(me.data);
        const d = await api.get<SessionDetail>(`/api/daily-checkin/sessions/${sessionId}`);
        setDetail(d.data);
      } catch {
        router.replace("/daily");
      } finally {
        setLoading(false);
      }
    }
    run();
  }, [router, sessionId]);

  async function submitAnswer() {
    const text = answer.trim();
    if (!text || !detail || detail.status !== "in_progress") return;
    setSending(true);
    setError("");
    try {
      const res = await api.post<SessionDetail>(
        `/api/daily-checkin/sessions/${sessionId}/answer`,
        { answer: text }
      );
      setDetail(res.data);
      setAnswer("");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(typeof msg === "string" ? msg : "Nie udało się zapisać odpowiedzi.");
    } finally {
      setSending(false);
    }
  }

  async function abandon() {
    if (!confirm("Zakończyć tę sesję teraz (nawet jeśli nie wszystkie pytania mają odpowiedzi)?")) {
      return;
    }
    setSending(true);
    setError("");
    try {
      await api.post(`/api/daily-checkin/sessions/${sessionId}/abandon`);
      router.replace("/daily");
    } catch {
      setError("Nie udało się zakończyć sesji.");
    } finally {
      setSending(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-slate-400 text-sm">Ładowanie…</p>
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  const total = detail.questions.length;
  const done = detail.status === "completed";
  const nextIdx = done ? total : detail.current_index;
  const progressLabel = done ? total : Math.min(nextIdx + 1, total);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <AppHeader user={user} />
      <main className="max-w-lg mx-auto px-4 py-8 w-full flex-1 space-y-6">
        <div className="flex items-center gap-3 text-sm">
          <Link href="/daily" className="text-slate-500 hover:text-brand-600 transition">
            ← Daily
          </Link>
          <span className="text-slate-300">·</span>
          <span className="text-slate-500">
            Pytanie {progressLabel} / {total}
          </span>
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {done ? (
          <div className="space-y-6">
            <div className="bg-green-50 dark:bg-green-950/30 border border-green-100 dark:border-green-900 rounded-2xl p-5">
              <p className="font-medium text-green-800 dark:text-green-200">Dziękujemy — check-in zapisany.</p>
              <p className="text-sm text-green-700/90 dark:text-green-300/90 mt-1">
                Poniżej podsumowanie Twoich odpowiedzi.
              </p>
            </div>
            <ol className="space-y-5">
              {detail.questions.map((q, i) => (
                <li
                  key={i}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4"
                >
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                    Pytanie {i + 1}
                  </p>
                  <p className="text-sm text-slate-800 dark:text-slate-100 mb-3">{q}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
                    {detail.answers[i] ?? "—"}
                  </p>
                </li>
              ))}
            </ol>
            <Link
              href="/daily"
              className="inline-flex justify-center w-full rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-medium py-3 px-5 transition"
            >
              Wróć do Daily
            </Link>
          </div>
        ) : (
          <>
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                Pytanie {nextIdx + 1}
              </p>
              <p className="text-base text-slate-900 dark:text-slate-100 leading-relaxed">
                {detail.questions[nextIdx]}
              </p>
            </div>

            <div>
              <label htmlFor="daily-answer" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Twoja odpowiedź
              </label>
              <textarea
                id="daily-answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={5}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-4 py-3 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none resize-y min-h-[120px]"
                placeholder="Napisz swobodnie…"
                disabled={sending}
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={submitAnswer}
                disabled={sending || !answer.trim()}
                className="flex-1 inline-flex justify-center rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium py-3 px-5 transition"
              >
                {sending ? "Zapisywanie…" : nextIdx + 1 >= total ? "Zapisz ostatnią odpowiedź" : "Dalej"}
              </button>
              <button
                type="button"
                onClick={abandon}
                disabled={sending}
                className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 py-3 px-2"
              >
                Zakończ bez dalszych odpowiedzi
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
