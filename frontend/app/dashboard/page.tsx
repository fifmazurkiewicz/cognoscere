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

interface Invitation {
  token: string;
  invite_url: string;
  expires_at: string;
  patient_name_hint: string | null;
}

interface Patient {
  id: string;
  display_name: string | null;
  first_name: string;
  email: string;
  has_protocol: boolean;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<HeaderUser | null>(null);
  const [loading, setLoading] = useState(true);

  const [patients, setPatients] = useState<Patient[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);

  const [patientNameHint, setPatientNameHint] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");

  useEffect(() => {
    if (!isLoggedIn()) {
      router.push("/login");
      return;
    }
    api
      .get<HeaderUser>("/api/auth/me")
      .then(async (res) => {
        if (res.data.role === "admin") {
          router.replace("/admin");
          return;
        }
        setUser(res.data);
        if (res.data.role === "therapist") {
          const [pRes, sRes] = await Promise.all([
            api.get("/api/patients"),
            api.get<SessionItem[]>("/api/sessions"),
          ]);
          setPatients(pRes.data);
          setSessions(sRes.data);
        } else {
          const sRes = await api.get("/api/sessions");
          setSessions(sRes.data);
        }
      })
      .catch(() => {
        clearTokens();
        router.push("/login");
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function handleCreateInvitation(e: React.FormEvent) {
    e.preventDefault();
    setInviteLoading(true);
    setInviteError("");
    try {
      const res = await api.post("/api/auth/invite", {
        patient_name_hint: patientNameHint || null,
      });
      setInvitation(res.data);
      setPatientNameHint("");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setInviteError(msg ?? "Błąd tworzenia zaproszenia");
    } finally {
      setInviteLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-slate-400 text-sm">Ładowanie…</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <AppHeader user={user} />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-8 flex-1 w-full">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            Cześć, {user.display_name ?? user.first_name}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm">
            {user.role === "therapist"
              ? `${user.professional_title ?? "Terapeuta"} · ${user.email}`
              : `Pacjent · ${user.email}`}
          </p>
        </div>

        {/* Panel terapeuty */}
        {user.role === "therapist" && (
          <>
            <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                Dla Ciebie — sesje i Daily
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Te same narzędzia co dla pacjentów: krótki check-in Daily oraz pełna sesja emocjonalna z AI
                (na własny użytek).
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/daily"
                  className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
                >
                  Daily
                </Link>
                <Link
                  href="/sessions"
                  className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
                >
                  Moje sesje
                </Link>
                <Link
                  href="/session/new"
                  className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  + Nowa sesja
                </Link>
              </div>
              {sessions.length > 0 && (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800 pt-3 mt-2">
                  {sessions.slice(0, 5).map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/session/${s.id}`}
                        className="flex items-center justify-between py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 -mx-2 px-2 rounded-lg transition"
                      >
                        <span className="text-slate-700 dark:text-slate-200 truncate pr-2">
                          {s.trigger_text}
                        </span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {STAGE_LABELS[s.current_stage] ?? s.current_stage}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Lista pacjentów */}
            <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                Twoi pacjenci{" "}
                <span className="text-slate-400 font-normal text-sm">({patients.length})</span>
              </h3>

              {patients.length === 0 ? (
                <p className="text-sm text-slate-400">
                  Brak pacjentów. Wygeneruj link zaproszenia poniżej.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {patients.map((p) => (
                    <li key={p.id} className="py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {p.display_name ?? p.first_name}
                        </p>
                        <p className="text-xs text-slate-400">{p.email}</p>
                      </div>
                      <Link
                        href={`/patients/${p.id}`}
                        className={`text-xs font-medium px-3 py-1.5 rounded-lg transition ${
                          p.has_protocol
                            ? "bg-brand-50 text-brand-600 hover:bg-brand-100"
                            : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                        }`}
                      >
                        {p.has_protocol ? "Edytuj protokół" : "Ustaw protokół"}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Zaproszenie */}
            <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Zaproś nowego pacjenta</h3>
              <form onSubmit={handleCreateInvitation} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Imię lub pseudonim pacjenta{" "}
                    <span className="text-slate-400 font-normal">(opcjonalne)</span>
                  </label>
                  <input
                    type="text"
                    value={patientNameHint}
                    onChange={(e) => setPatientNameHint(e.target.value)}
                    placeholder="np. Marek"
                    className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
                  />
                </div>
                {inviteError && (
                  <p className="text-red-600 text-sm">{inviteError}</p>
                )}
                <button
                  type="submit"
                  disabled={inviteLoading}
                  className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
                >
                  {inviteLoading ? "Generowanie…" : "Generuj link zaproszenia"}
                </button>
              </form>

              {invitation && (
                <div className="bg-brand-50 border border-brand-100 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-medium text-brand-800">
                    Link ważny 72 godziny — wyślij pacjentowi SMS-em lub emailem
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-white dark:bg-slate-950 border border-brand-200 dark:border-brand-800 rounded-lg px-3 py-2 text-slate-700 dark:text-slate-200 break-all">
                      {invitation.invite_url}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(invitation.invite_url)}
                      className="shrink-0 text-xs bg-brand-500 text-white px-3 py-2 rounded-lg hover:bg-brand-600 transition"
                    >
                      Kopiuj
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">
                    Wygasa: {new Date(invitation.expires_at).toLocaleString("pl-PL")}
                  </p>
                </div>
              )}
            </section>
          </>
        )}

        {/* Panel pacjenta */}
        {user.role === "patient" && (
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Sesje emocjonalne</h3>
              <div className="flex items-center gap-3 flex-wrap">
                <Link
                  href="/sessions"
                  className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
                >
                  Pełna historia →
                </Link>
                <Link
                  href="/session/new"
                  className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  + Nowa sesja
                </Link>
              </div>
            </div>

            {sessions.length === 0 ? (
              <p className="text-sm text-slate-400">
                Nie masz jeszcze żadnych sesji.
              </p>
            ) : (
              <>
                {(() => {
                  const active = sessions.filter((s) => s.status !== "completed");
                  const history = sessions.filter((s) => s.status === "completed");
                  const formatWhen = (iso: string) =>
                    new Date(iso).toLocaleString("pl-PL", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                  const row = (s: SessionItem) => (
                    <li key={s.id}>
                      <Link
                        href={`/session/${s.id}`}
                        className="flex items-center justify-between py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 -mx-2 px-2 rounded-lg transition"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-800 dark:text-slate-100 truncate">{s.trigger_text}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {formatWhen(s.created_at)}
                            {" · "}Samopoczucie: {s.wellbeing_before}/10
                            {s.wellbeing_after !== null && ` → ${s.wellbeing_after}/10`}
                          </p>
                        </div>
                        <span
                          className={`ml-3 shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${
                            s.status === "completed"
                              ? "bg-green-50 text-green-700"
                              : s.status === "crisis"
                              ? "bg-red-50 text-red-700"
                              : "bg-amber-50 text-amber-700"
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
                    <>
                      {active.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                            W toku ({active.length})
                          </h4>
                          <ul className="divide-y divide-slate-100 dark:divide-slate-800">{active.map(row)}</ul>
                        </div>
                      )}
                      {history.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                            Historia — zakończone ({history.length})
                          </h4>
                          <ul className="divide-y divide-slate-100 dark:divide-slate-800">{history.map(row)}</ul>
                        </div>
                      )}
                    </>
                  );
                })()}
              </>
            )}
          </section>
        )}

        <section className="bg-slate-100 dark:bg-slate-900/50 rounded-xl px-5 py-4 border border-slate-200/80 dark:border-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Dokumentacja API:{" "}
            <a
              href="http://localhost:8000/docs"
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 hover:underline"
            >
              localhost:8000/docs
            </a>
          </p>
        </section>
      </main>
    </div>
  );
}
