"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { clearTokens, isLoggedIn } from "@/lib/auth";

interface User {
  id: string;
  email: string;
  role: "therapist" | "patient";
  first_name: string;
  display_name: string | null;
  professional_title: string | null;
}

interface Invitation {
  token: string;
  invite_url: string;
  expires_at: string;
  patient_name_hint: string | null;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Stan dla terapeuty — tworzenie zaproszenia
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
      .get("/api/auth/me")
      .then((res) => setUser(res.data))
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

  function handleLogout() {
    clearTokens();
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-400 text-sm">Ładowanie…</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Nagłówek */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div>
          <span className="font-bold text-slate-800 text-lg">Cognoscere</span>
          <span className="ml-3 text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-medium">
            {user.role === "therapist" ? "Terapeuta" : "Pacjent"}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-500">
            {user.display_name ?? user.first_name}
          </span>
          <button
            onClick={handleLogout}
            className="text-sm text-slate-400 hover:text-slate-700 transition"
          >
            Wyloguj
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        {/* Powitanie */}
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            Cześć, {user.display_name ?? user.first_name} 👋
          </h2>
          <p className="text-slate-500 mt-1 text-sm">
            {user.role === "therapist"
              ? `${user.professional_title ?? "Terapeuta"} · ${user.email}`
              : `Pacjent · ${user.email}`}
          </p>
        </div>

        {/* Panel terapeuty */}
        {user.role === "therapist" && (
          <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
            <h3 className="font-semibold text-slate-800">Zaproś pacjenta</h3>
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
                  Link zaproszenia wygenerowany — ważny 72 godziny
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-white border border-brand-200 rounded-lg px-3 py-2 text-slate-700 break-all">
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
                  Wyślij ten link pacjentowi SMS-em lub emailem.
                  Wygasa:{" "}
                  {new Date(invitation.expires_at).toLocaleString("pl-PL")}
                </p>
              </div>
            )}
          </section>
        )}

        {/* Panel pacjenta */}
        {user.role === "patient" && (
          <section className="bg-white rounded-2xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-800 mb-2">Sesje emocjonalne</h3>
            <p className="text-slate-500 text-sm">
              Tutaj będą widoczne Twoje sesje. Funkcja w budowie — wróć wkrótce.
            </p>
          </section>
        )}

        {/* Info o statusie API */}
        <section className="bg-slate-100 rounded-xl px-5 py-4">
          <p className="text-xs text-slate-500">
            Backend API:{" "}
            <a
              href="http://localhost:8000/docs"
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 hover:underline"
            >
              localhost:8000/docs
            </a>{" "}
            · Swagger z pełną dokumentacją endpointów
          </p>
        </section>
      </main>
    </div>
  );
}
