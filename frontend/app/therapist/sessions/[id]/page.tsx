"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppHeader, type HeaderUser } from "@/components/app-header";
import { api } from "@/lib/api";
import { clearTokens, isLoggedIn } from "@/lib/auth";

interface Message {
  id: string;
  role: string;
  content: string;
  stage: string;
  created_at: string;
}

interface SessionView {
  id: string;
  status: string;
  current_stage: string;
  trigger_text: string;
  wellbeing_before: number;
  wellbeing_after: number | null;
  ai_summary: string | null;
  patient_facing_analysis: string | null;
  crisis_flag: boolean;
  messages: Message[];
}

export default function TherapistSessionViewPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [user, setUser] = useState<HeaderUser | null>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const me = await api.get<HeaderUser>("/api/auth/me");
        if (me.data.role !== "therapist") {
          router.replace("/dashboard");
          return;
        }
        if (cancelled) return;
        setUser(me.data);
        const res = await api.get<SessionView>(`/api/therapist/sessions/${sessionId}`);
        if (cancelled) return;
        setSession(res.data);
      } catch {
        if (!cancelled) setError("Nie udało się wczytać sesji lub brak dostępu.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, sessionId]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-slate-400 text-sm">Ładowanie…</p>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
        <AppHeader user={user} />
        <main className="max-w-2xl mx-auto px-4 py-10">
          <p className="text-red-600 dark:text-red-400 text-sm">{error || "Brak danych."}</p>
          <Link href="/dashboard" className="text-brand-600 dark:text-brand-400 text-sm mt-4 inline-block">
            ← Panel
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <AppHeader user={user} />
      <main className="max-w-2xl w-full mx-auto px-4 py-6 space-y-4 flex-1">
        <div className="flex items-center gap-3 text-sm">
          <Link
            href="/dashboard"
            className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          >
            ← Panel
          </Link>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Podgląd sesji pacjenta
          </p>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Transkrypt</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
            {session.trigger_text}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Status: {session.status} · Samopoczucie: {session.wellbeing_before}/10
            {session.wellbeing_after != null && ` → ${session.wellbeing_after}/10`}
          </p>
          {session.ai_summary && (
            <div className="text-sm border-t border-slate-100 dark:border-slate-800 pt-3 mt-3">
              <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">Podsumowanie (AI)</p>
              <p className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{session.ai_summary}</p>
            </div>
          )}
        </div>
        <div className="space-y-2">
          {session.messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm ${
                  m.role === "user"
                    ? "bg-brand-500 text-white rounded-br-sm"
                    : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-sm"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
