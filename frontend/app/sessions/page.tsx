"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppHeader, type HeaderUser } from "@/components/app-header";
import { api } from "@/lib/api";
import { clearTokens, isLoggedIn } from "@/lib/auth";

interface SessionItem {
  id: string;
  status: string;
  current_stage: string;
  trigger_text: string;
  wellbeing_before: number;
  wellbeing_after: number | null;
  created_at: string;
  completed_at: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  somatic: "Mapa ciała",
  emotion_id: "Emocje",
  thought_excavation: "Myśli",
  chain_challenging: "Podważenie",
  closing: "Zamknięcie",
  completed: "Ukończona",
};

export default function SessionsHistoryPage() {
  const router = useRouter();
  const [user, setUser] = useState<HeaderUser | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);

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
        const sRes = await api.get<SessionItem[]>("/api/sessions");
        setSessions(sRes.data);
      })
      .catch(() => {
        clearTokens();
        router.replace("/login");
      })
      .finally(() => setLoading(false));
  }, [router]);

  const formatWhen = (iso: string) =>
    new Date(iso).toLocaleString("pl-PL", {
      day: "numeric",
      month: "long",
      year: "numeric",
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

  const active = sessions.filter((s) => s.status !== "completed");
  const history = sessions.filter((s) => s.status === "completed");

  const row = (s: SessionItem) => (
    <li key={s.id}>
      <Link
        href={`/session/${s.id}`}
        className="flex items-center justify-between py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 -mx-2 px-2 rounded-lg transition"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-800 dark:text-slate-100 truncate">{s.trigger_text}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {formatWhen(s.created_at)}
            {" · "}Samopoczucie: {s.wellbeing_before}/10
            {s.wellbeing_after !== null && ` → ${s.wellbeing_after}/10`}
          </p>
        </div>
        <span
          className={`ml-3 shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${
            s.status === "completed"
              ? "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300"
              : s.status === "crisis"
                ? "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300"
                : "bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200"
          }`}
        >
          {s.status === "completed"
            ? "Ukończona"
            : s.status === "crisis"
              ? "Kryzys"
              : STAGE_LABELS[s.current_stage] ?? s.current_stage}
        </span>
      </Link>
    </li>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <AppHeader user={user} />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 w-full space-y-6 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Moje sesje</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Historia i sesje w toku
            </p>
          </div>
          <Link
            href="/session/new"
            className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Nowa sesja
          </Link>
        </div>

        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-6">
          {sessions.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nie masz jeszcze żadnych sesji.{" "}
              <Link href="/session/new" className="text-brand-600 dark:text-brand-400 font-medium">
                Rozpocznij pierwszą
              </Link>
              .
            </p>
          ) : (
            <>
              {active.length > 0 && (
                <div>
                  <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                    W toku ({active.length})
                  </h2>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">{active.map(row)}</ul>
                </div>
              )}
              {history.length > 0 && (
                <div>
                  <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                    Zakończone ({history.length})
                  </h2>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">{history.map(row)}</ul>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
