"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppHeader, type HeaderUser } from "@/components/app-header";
import { api } from "@/lib/api";
import { isLoggedIn } from "@/lib/auth";

interface PatientSessionRow {
  id: string;
  status: string;
  current_stage: string;
  trigger_text: string;
  wellbeing_before: number;
  wellbeing_after: number | null;
  created_at: string;
  completed_at: string | null;
}

interface DailyCheckinListRow {
  id: string;
  status: string;
  question_count: number;
  answered_count: number;
  created_at: string;
  completed_at: string | null;
}

type Approach = "cbt" | "act" | "dbt" | "psychodynamic" | "mixed";
type Intensity = "gentle" | "moderate" | "confrontational";

const APPROACH_LABELS: Record<Approach, string> = {
  cbt: "CBT — Terapia poznawczo-behawioralna",
  act: "ACT — Acceptance and Commitment Therapy",
  dbt: "DBT — Dialectical Behavior Therapy",
  psychodynamic: "Psychodynamiczna",
  mixed: "Mieszana",
};

const INTENSITY_LABELS: Record<Intensity, string> = {
  gentle: "Delikatne — wspierające, bez konfrontacji",
  moderate: "Umiarkowane — balans wsparcia i wyzwania",
  confrontational: "Konfrontacyjne — aktywne podważanie przekonań",
};

const FOCUS_AREAS: { value: string; label: string }[] = [
  { value: "social_anxiety", label: "Lęk społeczny" },
  { value: "depression", label: "Depresja" },
  { value: "anger", label: "Gniew" },
  { value: "trauma", label: "Trauma" },
  { value: "self_esteem", label: "Samoocena" },
  { value: "relationships", label: "Relacje" },
  { value: "work_stress", label: "Stres w pracy" },
  { value: "grief", label: "Żałoba / strata" },
  { value: "perfectionism", label: "Perfekcjonizm" },
  { value: "boundaries", label: "Granice" },
];

interface Protocol {
  approach: Approach;
  focus_areas: string[];
  patient_context: string;
  ai_instructions: string;
  challenge_intensity: Intensity;
  somatic_focus: boolean;
  max_session_length: number;
  crisis_protocol: string;
  version?: number;
}

const DEFAULT_CRISIS =
  "Słyszę, że jest Ci teraz bardzo ciężko. Proszę, zadzwoń na Telefon Zaufania: 116 123 (czynny całą dobę) lub napisz do swojego terapeuty.";

const DEFAULT_FORM: Protocol = {
  approach: "cbt",
  focus_areas: [],
  patient_context: "",
  ai_instructions: "",
  challenge_intensity: "moderate",
  somatic_focus: true,
  max_session_length: 30,
  crisis_protocol: DEFAULT_CRISIS,
};

export default function PatientProtocolPage() {
  const params = useParams();
  const router = useRouter();
  const patientId = params.id as string;

  const [form, setForm] = useState<Protocol>(DEFAULT_FORM);
  const [patientName, setPatientName] = useState("");
  const [headerUser, setHeaderUser] = useState<HeaderUser | null>(null);
  const [patientSessions, setPatientSessions] = useState<PatientSessionRow[]>([]);
  const [patientDailySessions, setPatientDailySessions] = useState<DailyCheckinListRow[]>([]);
  const [dailyQuestions, setDailyQuestions] = useState<string[]>([]);
  const [dailyIsCustom, setDailyIsCustom] = useState(false);
  const [dailySaving, setDailySaving] = useState(false);
  const [dailySaved, setDailySaved] = useState(false);
  const [dailyError, setDailyError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoggedIn()) {
      router.push("/login");
      return;
    }

    async function load() {
      try {
        const me = await api.get<HeaderUser>("/api/auth/me");
        if (me.data.role !== "therapist") {
          router.push("/dashboard");
          return;
        }
        setHeaderUser(me.data);

        const [patientsRes, protocolRes, sessionsRes, dailyQRes, dailySessRes] =
          await Promise.allSettled([
            api.get("/api/patients"),
            api.get(`/api/patients/${patientId}/protocol`),
            api.get<PatientSessionRow[]>(`/api/therapist/patients/${patientId}/sessions`),
            api.get<{ questions: string[]; is_custom: boolean }>(
              `/api/patients/${patientId}/daily-questions`
            ),
            api.get<DailyCheckinListRow[]>(
              `/api/patients/${patientId}/daily-checkin-sessions`
            ),
          ]);

        if (patientsRes.status === "fulfilled") {
          const patient = patientsRes.value.data.find(
            (p: { id: string; display_name: string | null; first_name: string }) =>
              p.id === patientId
          );
          if (patient) {
            setPatientName(patient.display_name ?? patient.first_name);
          }
        }

        if (protocolRes.status === "fulfilled") {
          setForm(protocolRes.value.data);
        }
        if (sessionsRes.status === "fulfilled") {
          setPatientSessions(sessionsRes.value.data);
        }
        if (dailyQRes.status === "fulfilled") {
          setDailyQuestions(dailyQRes.value.data.questions);
          setDailyIsCustom(dailyQRes.value.data.is_custom);
        }
        if (dailySessRes.status === "fulfilled") {
          setPatientDailySessions(dailySessRes.value.data);
        }
      } catch {
        setError("Nie udało się załadować danych pacjenta.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [patientId, router]);

  function toggleFocusArea(value: string) {
    setForm((prev) => ({
      ...prev,
      focus_areas: prev.focus_areas.includes(value)
        ? prev.focus_areas.filter((a) => a !== value)
        : [...prev.focus_areas, value],
    }));
  }

  function setDailyQuestionAt(index: number, value: string) {
    setDailyQuestions((prev) => prev.map((q, i) => (i === index ? value : q)));
  }

  function addDailyQuestion() {
    setDailyQuestions((prev) => (prev.length >= 30 ? prev : [...prev, ""]));
  }

  function removeDailyQuestion(index: number) {
    setDailyQuestions((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function saveDailyQuestions(e: React.FormEvent) {
    e.preventDefault();
    setDailySaving(true);
    setDailyError("");
    setDailySaved(false);
    const trimmed = dailyQuestions.map((q) => q.trim()).filter(Boolean);
    if (trimmed.length < 1) {
      setDailyError("Potrzebne jest co najmniej jedno pytanie.");
      setDailySaving(false);
      return;
    }
    try {
      await api.put(`/api/patients/${patientId}/daily-questions`, { questions: trimmed });
      setDailyQuestions(trimmed);
      setDailyIsCustom(true);
      setDailySaved(true);
      setTimeout(() => setDailySaved(false), 3000);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setDailyError(
        typeof msg === "string" ? msg : "Nie udało się zapisać pytań Daily."
      );
    } finally {
      setDailySaving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await api.put(`/api/patients/${patientId}/protocol`, form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(msg ?? "Błąd zapisu protokołu.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !headerUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-slate-400 text-sm">Ładowanie…</p>
      </div>
    );
  }

  const formatSess = (iso: string) =>
    new Date(iso).toLocaleString("pl-PL", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <AppHeader user={headerUser} />
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
        <Link
          href="/dashboard"
          className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-sm transition"
        >
          ← Dashboard
        </Link>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          Protokół — {patientName || "pacjent"}
        </span>
        {form.version && (
          <span className="text-xs text-slate-400">wersja {form.version}</span>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10 w-full flex-1 space-y-8">
        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-3">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">Sesje pacjenta</h2>
          {patientSessions.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Brak zapisanych sesji.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {patientSessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/therapist/sessions/${s.id}`}
                    className="flex items-center justify-between py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 -mx-2 px-2 rounded-lg transition text-sm"
                  >
                    <span className="text-slate-700 dark:text-slate-200 truncate pr-2">
                      {s.trigger_text}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">{formatSess(s.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">Daily — check-in</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Stała lista pytań bez udziału AI. Pacjent wypełnia je w zakładce Daily. Jeśli nie zapiszesz
            własnego zestawu, pacjent widzi domyślne 6 pytań.
            {dailyIsCustom && (
              <span className="block mt-1 text-brand-600 dark:text-brand-400">
                Zapisano indywidualny schemat dla tej osoby.
              </span>
            )}
          </p>

          <form onSubmit={saveDailyQuestions} className="space-y-3">
            {dailyQuestions.map((q, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="text-xs text-slate-400 w-6 pt-2.5 shrink-0">{i + 1}.</span>
                <textarea
                  value={q}
                  onChange={(e) => setDailyQuestionAt(i, e.target.value)}
                  rows={2}
                  className="flex-1 min-w-0 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
                />
                <button
                  type="button"
                  onClick={() => removeDailyQuestion(i)}
                  disabled={dailyQuestions.length <= 1}
                  className="text-xs text-slate-400 hover:text-red-600 disabled:opacity-30 pt-2 shrink-0"
                >
                  Usuń
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addDailyQuestion}
              disabled={dailyQuestions.length >= 30}
              className="text-sm text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-40"
            >
              + Dodaj pytanie
            </button>
            {dailyError && (
              <p className="text-sm text-red-600 dark:text-red-400">{dailyError}</p>
            )}
            {dailySaved && (
              <p className="text-sm text-green-600 dark:text-green-400">Pytania Daily zapisane.</p>
            )}
            <button
              type="submit"
              disabled={dailySaving}
              className="w-full sm:w-auto bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 px-5 rounded-xl transition"
            >
              {dailySaving ? "Zapisywanie…" : "Zapisz pytania Daily"}
            </button>
          </form>

          <div className="border-t border-slate-100 dark:border-slate-800 pt-4 mt-4">
            <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
              Odpowiedzi pacjenta (check-iny)
            </h3>
            {patientDailySessions.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Jeszcze brak.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {patientDailySessions.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/patients/${patientId}/daily/${s.id}`}
                      className="flex items-center justify-between py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 -mx-2 px-2 rounded-lg transition text-sm"
                    >
                      <span className="text-slate-700 dark:text-slate-200">
                        {s.answered_count}/{s.question_count} odpowiedzi
                        {s.status === "in_progress" && (
                          <span className="ml-2 text-amber-600 dark:text-amber-400 text-xs">
                            w toku
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">
                        {formatSess(s.created_at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <form onSubmit={handleSubmit} className="space-y-8">

          {/* Podejście terapeutyczne */}
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h2 className="font-semibold text-slate-800 dark:text-slate-100">Podejście terapeutyczne</h2>
            <div className="space-y-2">
              {(Object.entries(APPROACH_LABELS) as [Approach, string][]).map(([value, label]) => (
                <label key={value} className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="radio"
                    name="approach"
                    value={value}
                    checked={form.approach === value}
                    onChange={() => setForm((p) => ({ ...p, approach: value }))}
                    className="h-4 w-4 text-brand-500 border-slate-300 focus:ring-brand-500"
                  />
                  <span className="text-sm text-slate-700 group-hover:text-slate-900">{label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Obszary fokus */}
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h2 className="font-semibold text-slate-800 dark:text-slate-100">Obszary fokus</h2>
            <p className="text-xs text-slate-400">AI będzie skupiał się na tych obszarach podczas eksploracji.</p>
            <div className="grid grid-cols-2 gap-2">
              {FOCUS_AREAS.map(({ value, label }) => (
                <label key={value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.focus_areas.includes(value)}
                    onChange={() => toggleFocusArea(value)}
                    className="h-4 w-4 rounded text-brand-500 border-slate-300 focus:ring-brand-500"
                  />
                  <span className="text-sm text-slate-700">{label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Kontekst pacjenta */}
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h2 className="font-semibold text-slate-800 dark:text-slate-100">Kontekst pacjenta</h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Co AI powinien wiedzieć o pacjencie?{" "}
                <span className="text-slate-400 font-normal">
                  ({form.patient_context.length}/500)
                </span>
              </label>
              <textarea
                value={form.patient_context}
                onChange={(e) => setForm((p) => ({ ...p, patient_context: e.target.value }))}
                maxLength={500}
                rows={3}
                placeholder="np. Pacjent pracuje w korporacji, ma trudności z wyrażaniem emocji, skłonność do intelektualizacji…"
                className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Dodatkowe instrukcje dla AI{" "}
                <span className="text-slate-400 font-normal">
                  ({form.ai_instructions.length}/1000)
                </span>
              </label>
              <textarea
                value={form.ai_instructions}
                onChange={(e) => setForm((p) => ({ ...p, ai_instructions: e.target.value }))}
                maxLength={1000}
                rows={4}
                placeholder="np. Nie pogłębiaj wątków dotyczących ojca bez wyraźnej inicjatywy pacjenta. Skupiaj się na przekonaniach związanych z pracą…"
                className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition resize-none"
              />
            </div>
          </section>

          {/* Parametry sesji */}
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5">
            <h2 className="font-semibold text-slate-800">Parametry sesji</h2>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Intensywność konfrontacji
              </label>
              <div className="space-y-2">
                {(Object.entries(INTENSITY_LABELS) as [Intensity, string][]).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="intensity"
                      value={value}
                      checked={form.challenge_intensity === value}
                      onChange={() => setForm((p) => ({ ...p, challenge_intensity: value }))}
                      className="h-4 w-4 text-brand-500 border-slate-300 focus:ring-brand-500"
                    />
                    <span className="text-sm text-slate-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="somatic"
                checked={form.somatic_focus}
                onChange={(e) => setForm((p) => ({ ...p, somatic_focus: e.target.checked }))}
                className="h-4 w-4 rounded text-brand-500 border-slate-300 focus:ring-brand-500"
              />
              <label htmlFor="somatic" className="text-sm text-slate-700 cursor-pointer">
                Mocny fokus na doznaniach somatycznych (mapa ciała)
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Sugerowana długość sesji:{" "}
                <span className="text-brand-600 font-semibold">{form.max_session_length} min</span>
              </label>
              <input
                type="range"
                min={15}
                max={90}
                step={15}
                value={form.max_session_length}
                onChange={(e) =>
                  setForm((p) => ({ ...p, max_session_length: Number(e.target.value) }))
                }
                className="w-full accent-brand-500"
              />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>15 min</span>
                <span>90 min</span>
              </div>
            </div>
          </section>

          {/* Protokół kryzysowy */}
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-3">
            <h2 className="font-semibold text-slate-800">Protokół kryzysowy</h2>
            <p className="text-xs text-slate-400">
              Wiadomość wyświetlana pacjentowi gdy AI wykryje sygnały kryzysu
              (myśli samobójcze, samookaleczenie). Terapeuta otrzymuje email z powiadomieniem.
            </p>
            <textarea
              value={form.crisis_protocol}
              onChange={(e) => setForm((p) => ({ ...p, crisis_protocol: e.target.value }))}
              rows={3}
              className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent transition resize-none"
            />
          </section>

          {/* Zapis */}
          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3 border border-red-200">
              {error}
            </div>
          )}

          {saved && (
            <div className="bg-green-50 text-green-700 text-sm rounded-lg px-4 py-3 border border-green-200">
              Protokół zapisany.
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl text-sm transition-colors"
          >
            {saving ? "Zapisywanie…" : "Zapisz protokół"}
          </button>
        </form>
      </main>
    </div>
  );
}
