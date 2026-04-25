"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { GuestThemeControls } from "@/components/guest-theme-controls";
import { PasswordInput } from "@/components/password-input";
import { api } from "@/lib/api";
import { saveTokens } from "@/lib/auth";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token");

  const isPatient = !!inviteToken;

  const [inviteInfo, setInviteInfo] = useState<{
    therapist_first_name: string;
    patient_name_hint: string | null;
  } | null>(null);
  const [inviteError, setInviteError] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [gdprConsent, setGdprConsent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    api
      .get(`/api/auth/invite/${inviteToken}`)
      .then((res) => {
        if (!res.data.valid) {
          setInviteError("Link zaproszenia jest nieprawidłowy lub wygasł.");
        } else {
          setInviteInfo(res.data);
          if (res.data.patient_name_hint) setDisplayName(res.data.patient_name_hint);
        }
      })
      .catch(() => setInviteError("Nie udało się zweryfikować linku zaproszenia."));
  }, [inviteToken]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (isPatient) {
        const res = await api.post("/api/auth/register/patient", {
          token: inviteToken,
          email,
          password,
          display_name: displayName,
          gdpr_consent: gdprConsent,
        });
        saveTokens(res.data.access_token, res.data.refresh_token);
      } else {
        const res = await api.post("/api/auth/register/therapist", {
          email,
          password,
          first_name: firstName,
          gdpr_consent: gdprConsent,
        });
        saveTokens(res.data.access_token, res.data.refresh_token);
      }
      router.push("/dashboard");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(msg ?? "Błąd rejestracji. Spróbuj ponownie.");
    } finally {
      setLoading(false);
    }
  }

  if (isPatient && inviteError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-slate-50 dark:bg-slate-950">
        <GuestThemeControls />
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-3">Cognoscere</h1>
          <div className="bg-red-50 text-red-700 rounded-xl border border-red-200 px-6 py-5">
            <p className="font-medium">Nieprawidłowy link</p>
            <p className="text-sm mt-1">{inviteError}</p>
          </div>
          <Link href="/login" className="inline-block mt-4 text-sm text-brand-600 hover:underline">
            Wróć do logowania
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-50 dark:bg-slate-950 transition-colors">
      <GuestThemeControls />
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100">Cognoscere</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">
            {isPatient
              ? inviteInfo
                ? `Zaproszenie od terapeuty: ${inviteInfo.therapist_first_name}`
                : "Weryfikacja zaproszenia…"
              : "Rejestracja terapeuty"}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-8 space-y-5"
        >
          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3 border border-red-200">
              {error}
            </div>
          )}

          {!isPatient && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Imię
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  placeholder="Jan"
                  className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-950 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
                />
              </div>
            </>
          )}

          {isPatient && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Pseudonim (widoczny w aplikacji)
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                placeholder="Jak chcesz być widoczny"
                className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-950 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="twoj@email.pl"
              className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-950 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
            />
          </div>

          <PasswordInput
            label={
              <>
                Hasło <span className="text-slate-400 font-normal">(min. 8 znaków)</span>
              </>
            }
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={gdprConsent}
              onChange={(e) => setGdprConsent(e.target.checked)}
              required
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
            />
            <span className="text-sm text-slate-600">
              Wyrażam zgodę na przetwarzanie danych osobowych zgodnie z RODO.
              Dane są przechowywane wyłącznie na potrzeby aplikacji i dostępne
              tylko dla mnie i mojego terapeuty.
            </span>
          </label>

          <button
            type="submit"
            disabled={loading || !gdprConsent}
            className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            {loading ? "Rejestracja…" : "Utwórz konto"}
          </button>

          <p className="text-center text-sm text-slate-500">
            Masz już konto?{" "}
            <Link href="/login" className="text-brand-600 hover:underline font-medium">
              Zaloguj się
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
