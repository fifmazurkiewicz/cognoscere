"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppHeader, type HeaderUser } from "@/components/app-header";
import { api } from "@/lib/api";
import { isLoggedIn } from "@/lib/auth";

interface SessionDetail {
  id: string;
  questions: string[];
  answers: string[];
  current_index: number;
  status: string;
  created_at: string;
  completed_at: string | null;
}

export default function TherapistDailySessionViewPage() {
  const params = useParams();
  const router = useRouter();
  const patientId = params.id as string;
  const sessionId = params.sessionId as string;

  const [user, setUser] = useState<HeaderUser | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.push("/login");
      return;
    }

    async function run() {
      try {
        const me = await api.get<HeaderUser>("/api/auth/me");
        if (me.data.role !== "therapist") {
          router.push("/dashboard");
          return;
        }
        setUser(me.data);
        const d = await api.get<SessionDetail>(
          `/api/patients/${patientId}/daily-checkin-sessions/${sessionId}`
        );
        setDetail(d.data);
      } catch {
        router.push(`/patients/${patientId}`);
      } finally {
        setLoading(false);
      }
    }
    run();
  }, [router, patientId, sessionId]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-slate-400 text-sm">Ładowanie…</p>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <AppHeader user={user} />
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3">
        <Link
          href={`/patients/${patientId}`}
          className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-sm transition"
        >
          ← Protokół pacjenta
        </Link>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8 w-full flex-1 space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <span>
            {new Date(detail.created_at).toLocaleString("pl-PL", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span>·</span>
          <span>
            {detail.status === "completed" ? "Ukończona" : "W toku"} · {detail.answers.length}/
            {detail.questions.length} odpowiedzi
          </span>
        </div>

        <ol className="space-y-4">
          {detail.questions.map((q, i) => (
            <li
              key={i}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5"
            >
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                Pytanie {i + 1}
              </p>
              <p className="text-sm text-slate-800 dark:text-slate-100 mb-3">{q}</p>
              <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap border-t border-slate-100 dark:border-slate-800 pt-3">
                {detail.answers[i]?.trim() ? detail.answers[i] : "— brak odpowiedzi —"}
              </p>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
