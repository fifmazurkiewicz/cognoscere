"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "@/lib/api";
import { isLoggedIn } from "@/lib/auth";

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = "protocol" | "sessions" | "analytics";
type Approach = "cbt" | "act" | "dbt" | "psychodynamic" | "mixed";
type Intensity = "gentle" | "moderate" | "confrontational";

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

interface PatientSession {
  id: string;
  status: string;
  current_stage: string;
  wellbeing_before: number;
  wellbeing_after: number | null;
  crisis_flag: boolean;
  created_at: string;
  completed_at: string | null;
}

interface WellbeingPoint {
  session_date: string;
  wellbeing_before: number;
  wellbeing_after: number | null;
}

interface EmotionFrequency {
  emotion: string;
  count: number;
}

interface DistortionFrequency {
  distortion: string;
  count: number;
}

interface Analytics {
  wellbeing_over_time: WellbeingPoint[];
  emotion_frequency: EmotionFrequency[];
  cognitive_distortions: DistortionFrequency[];
  session_count: number;
  completed_session_count: number;
  avg_wellbeing_delta: number | null;
}

// ─── Labels ──────────────────────────────────────────────────────────────────

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

const EMOTION_LABELS: Record<string, string> = {
  fear: "Strach",
  anger: "Złość",
  sadness: "Smutek",
  shame: "Wstyd",
  disgust: "Odraza",
  guilt: "Poczucie winy",
  anxiety: "Lęk",
};

const DISTORTION_LABELS: Record<string, string> = {
  catastrophizing: "Katastrofizacja",
  mind_reading: "Czytanie w myślach",
  personalization: "Personalizacja",
  mental_filter: "Filtr mentalny",
  all_or_nothing: "Zero-jedynkowe",
  should_statements: "Powinienem",
  emotional_reasoning: "Rozumowanie emocj.",
  labeling: "Etykietowanie",
};

const STAGE_LABELS: Record<string, string> = {
  somatic: "Mapa ciała",
  emotion_id: "Emocje",
  thought_excavation: "Myśli",
  chain_challenging: "Podważenie",
  closing: "Zamknięcie",
  completed: "Ukończona",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Aktywna",
  completed: "Ukończona",
  abandoned: "Przerwana",
  crisis: "Kryzys",
};

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: "bg-blue-50 text-blue-700",
    completed: "bg-green-50 text-green-700",
    abandoned: "bg-slate-100 text-slate-500",
    crisis: "bg-red-50 text-red-700",
  };
  return map[status] ?? "bg-slate-100 text-slate-500";
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PatientPage() {
  const params = useParams();
  const router = useRouter();
  const patientId = params.id as string;

  const [tab, setTab] = useState<Tab>("protocol");
  const [patientName, setPatientName] = useState("");
  const [loading, setLoading] = useState(true);

  // Protocol tab
  const [form, setForm] = useState<Protocol>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [protocolError, setProtocolError] = useState("");

  // Sessions tab
  const [sessions, setSessions] = useState<PatientSession[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Analytics tab
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.push("/login");
      return;
    }

    async function load() {
      try {
        const [patientsRes, protocolRes] = await Promise.allSettled([
          api.get("/api/patients"),
          api.get(`/api/patients/${patientId}/protocol`),
        ]);

        if (patientsRes.status === "fulfilled") {
          const patient = patientsRes.value.data.find(
            (p: { id: string; display_name: string | null; first_name: string }) =>
              p.id === patientId
          );
          if (patient) setPatientName(patient.display_name ?? patient.first_name);
        }

        if (protocolRes.status === "fulfilled") {
          setForm(protocolRes.value.data);
        }
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [patientId, router]);

  async function loadSessions() {
    if (sessions !== null) return;
    setSessionsLoading(true);
    try {
      const res = await api.get(`/api/therapist/patients/${patientId}/sessions`);
      setSessions(res.data);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }

  async function loadAnalytics() {
    if (analytics !== null) return;
    setAnalyticsLoading(true);
    try {
      const res = await api.get(`/api/patients/${patientId}/analytics`);
      setAnalytics(res.data);
    } catch {
      setAnalytics({
        wellbeing_over_time: [],
        emotion_frequency: [],
        cognitive_distortions: [],
        session_count: 0,
        completed_session_count: 0,
        avg_wellbeing_delta: null,
      });
    } finally {
      setAnalyticsLoading(false);
    }
  }

  function switchTab(t: Tab) {
    setTab(t);
    if (t === "sessions") loadSessions();
    if (t === "analytics") loadAnalytics();
  }

  function toggleFocusArea(value: string) {
    setForm((prev) => ({
      ...prev,
      focus_areas: prev.focus_areas.includes(value)
        ? prev.focus_areas.filter((a) => a !== value)
        : [...prev.focus_areas, value],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setProtocolError("");
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
      setProtocolError(msg ?? "Błąd zapisu protokołu.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-400 text-sm">Ładowanie…</p>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "protocol", label: "Protokół" },
    { key: "sessions", label: "Sesje" },
    { key: "analytics", label: "Wykresy" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-3 py-3">
            <Link
              href="/dashboard"
              className="text-slate-400 hover:text-slate-700 text-sm transition shrink-0"
            >
              ←
            </Link>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-800 text-sm truncate">
                {patientName || "Pacjent"}
              </p>
              {form.version && (
                <p className="text-xs text-slate-400">protokół v{form.version}</p>
              )}
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 pb-0">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => switchTab(t.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.key
                    ? "border-brand-500 text-brand-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">

        {/* ── PROTOKÓŁ ─────────────────────────────────────────────────────── */}
        {tab === "protocol" && (
          <form onSubmit={handleSubmit} className="space-y-5">

            <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h2 className="font-semibold text-slate-800 text-sm">Podejście terapeutyczne</h2>
              <div className="space-y-2.5">
                {(Object.entries(APPROACH_LABELS) as [Approach, string][]).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="radio"
                      name="approach"
                      value={value}
                      checked={form.approach === value}
                      onChange={() => setForm((p) => ({ ...p, approach: value }))}
                      className="h-4 w-4 text-brand-500 border-slate-300 focus:ring-brand-500 shrink-0"
                    />
                    <span className="text-sm text-slate-700 group-hover:text-slate-900">{label}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h2 className="font-semibold text-slate-800 text-sm">Obszary fokus</h2>
              <p className="text-xs text-slate-400">AI skupi się na tych obszarach podczas eksploracji.</p>
              <div className="grid grid-cols-2 gap-2">
                {FOCUS_AREAS.map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.focus_areas.includes(value)}
                      onChange={() => toggleFocusArea(value)}
                      className="h-4 w-4 rounded text-brand-500 border-slate-300 focus:ring-brand-500 shrink-0"
                    />
                    <span className="text-sm text-slate-700">{label}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h2 className="font-semibold text-slate-800 text-sm">Kontekst pacjenta</h2>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Co AI powinien wiedzieć o pacjencie?{" "}
                  <span className="text-slate-400 font-normal">({form.patient_context.length}/500)</span>
                </label>
                <textarea
                  value={form.patient_context}
                  onChange={(e) => setForm((p) => ({ ...p, patient_context: e.target.value }))}
                  maxLength={500}
                  rows={3}
                  placeholder="np. Pacjent pracuje w korporacji, trudności z wyrażaniem emocji…"
                  className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Dodatkowe instrukcje dla AI{" "}
                  <span className="text-slate-400 font-normal">({form.ai_instructions.length}/1000)</span>
                </label>
                <textarea
                  value={form.ai_instructions}
                  onChange={(e) => setForm((p) => ({ ...p, ai_instructions: e.target.value }))}
                  maxLength={1000}
                  rows={4}
                  placeholder="np. Nie pogłębiaj wątków dotyczących ojca bez inicjatywy pacjenta…"
                  className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition resize-none"
                />
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
              <h2 className="font-semibold text-slate-800 text-sm">Parametry sesji</h2>

              <div className="space-y-2.5">
                <p className="text-xs font-medium text-slate-600">Intensywność konfrontacji</p>
                {(Object.entries(INTENSITY_LABELS) as [Intensity, string][]).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="intensity"
                      value={value}
                      checked={form.challenge_intensity === value}
                      onChange={() => setForm((p) => ({ ...p, challenge_intensity: value }))}
                      className="h-4 w-4 text-brand-500 border-slate-300 focus:ring-brand-500 shrink-0"
                    />
                    <span className="text-sm text-slate-700">{label}</span>
                  </label>
                ))}
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.somatic_focus}
                  onChange={(e) => setForm((p) => ({ ...p, somatic_focus: e.target.checked }))}
                  className="h-4 w-4 rounded text-brand-500 border-slate-300 focus:ring-brand-500 shrink-0"
                />
                <span className="text-sm text-slate-700">Mocny fokus na doznaniach somatycznych (mapa ciała)</span>
              </label>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">
                  Sugerowana długość sesji:{" "}
                  <span className="text-brand-600 font-semibold">{form.max_session_length} min</span>
                </label>
                <input
                  type="range"
                  min={15}
                  max={90}
                  step={15}
                  value={form.max_session_length}
                  onChange={(e) => setForm((p) => ({ ...p, max_session_length: Number(e.target.value) }))}
                  className="w-full accent-brand-500"
                />
                <div className="flex justify-between text-xs text-slate-400 mt-1">
                  <span>15 min</span>
                  <span>90 min</span>
                </div>
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
              <h2 className="font-semibold text-slate-800 text-sm">Protokół kryzysowy</h2>
              <p className="text-xs text-slate-400">
                Wiadomość wyświetlana pacjentowi, gdy AI wykryje sygnały kryzysu.
              </p>
              <textarea
                value={form.crisis_protocol}
                onChange={(e) => setForm((p) => ({ ...p, crisis_protocol: e.target.value }))}
                rows={3}
                className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent transition resize-none"
              />
            </section>

            {protocolError && (
              <div className="bg-red-50 text-red-700 text-sm rounded-xl px-4 py-3 border border-red-200">
                {protocolError}
              </div>
            )}
            {saved && (
              <div className="bg-green-50 text-green-700 text-sm rounded-xl px-4 py-3 border border-green-200">
                Protokół zapisany.
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium py-3 rounded-xl text-sm transition-colors"
            >
              {saving ? "Zapisywanie…" : "Zapisz protokół"}
            </button>
          </form>
        )}

        {/* ── SESJE ──────────────────────────────────────────────────────────── */}
        {tab === "sessions" && (
          <div className="space-y-3">
            {sessionsLoading && (
              <div className="py-16 text-center">
                <p className="text-slate-400 text-sm">Ładowanie sesji…</p>
              </div>
            )}

            {!sessionsLoading && sessions && sessions.length === 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                <p className="text-sm text-slate-400">Pacjent nie przeprowadził jeszcze żadnej sesji.</p>
              </div>
            )}

            {!sessionsLoading && sessions && sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  sessionStorage.setItem("therapist_patient_id", patientId);
                  router.push(`/therapist/sessions/${s.id}`);
                }}
                className="w-full text-left bg-white rounded-2xl border border-slate-200 p-4 hover:border-brand-300 hover:shadow-sm transition-all group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-800 text-sm">
                      {fmtDate(s.created_at)}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {STAGE_LABELS[s.current_stage] ?? s.current_stage}
                      {s.crisis_flag && (
                        <span className="ml-2 text-red-600 font-medium">· Kryzys</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusBadge(s.status)}`}>
                      {STATUS_LABELS[s.status] ?? s.status}
                    </span>
                    <span className="text-slate-300 group-hover:text-brand-400 transition text-sm">→</span>
                  </div>
                </div>

                {(s.wellbeing_before !== undefined) && (
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-400">Przed</span>
                      <div className="h-1.5 w-16 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-400 rounded-full"
                          style={{ width: `${s.wellbeing_before * 10}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-600 font-medium">{s.wellbeing_before}</span>
                    </div>
                    {s.wellbeing_after !== null && (
                      <>
                        <span className="text-slate-200">→</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-slate-400">Po</span>
                          <div className="h-1.5 w-16 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-brand-500 rounded-full"
                              style={{ width: `${s.wellbeing_after * 10}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-600 font-medium">{s.wellbeing_after}</span>
                        </div>
                        {s.wellbeing_after > s.wellbeing_before && (
                          <span className="text-xs text-green-600 font-medium ml-auto">
                            +{s.wellbeing_after - s.wellbeing_before}
                          </span>
                        )}
                        {s.wellbeing_after < s.wellbeing_before && (
                          <span className="text-xs text-red-500 font-medium ml-auto">
                            {s.wellbeing_after - s.wellbeing_before}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── WYKRESY ────────────────────────────────────────────────────────── */}
        {tab === "analytics" && (
          <div className="space-y-5">
            {analyticsLoading && (
              <div className="py-16 text-center">
                <p className="text-slate-400 text-sm">Ładowanie danych…</p>
              </div>
            )}

            {!analyticsLoading && analytics && (
              <>
                {/* Stats summary */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
                    <p className="text-2xl font-bold text-slate-800">{analytics.session_count}</p>
                    <p className="text-xs text-slate-500 mt-1">Sesji łącznie</p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
                    <p className="text-2xl font-bold text-slate-800">{analytics.completed_session_count}</p>
                    <p className="text-xs text-slate-500 mt-1">Ukończonych</p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
                    {analytics.avg_wellbeing_delta !== null ? (
                      <>
                        <p className={`text-2xl font-bold ${analytics.avg_wellbeing_delta > 0 ? "text-green-600" : analytics.avg_wellbeing_delta < 0 ? "text-red-500" : "text-slate-800"}`}>
                          {analytics.avg_wellbeing_delta > 0 ? "+" : ""}{analytics.avg_wellbeing_delta.toFixed(1)}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">Śr. zmiana</p>
                      </>
                    ) : (
                      <>
                        <p className="text-2xl font-bold text-slate-300">—</p>
                        <p className="text-xs text-slate-400 mt-1">Śr. zmiana</p>
                      </>
                    )}
                  </div>
                </div>

                {/* Wellbeing over time */}
                {analytics.wellbeing_over_time.length > 0 && (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                    <h2 className="font-semibold text-slate-800 text-sm">Samopoczucie w czasie</h2>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart
                        data={analytics.wellbeing_over_time.map((p, i) => ({
                          name: `#${i + 1}`,
                          przed: p.wellbeing_before,
                          po: p.wellbeing_after,
                        }))}
                        margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                        <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                          formatter={(val: number, name: string) => [val, name === "przed" ? "Przed" : "Po"]}
                        />
                        <Line
                          type="monotone"
                          dataKey="przed"
                          stroke="#cbd5e1"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "#cbd5e1" }}
                          name="przed"
                        />
                        <Line
                          type="monotone"
                          dataKey="po"
                          stroke="#6366f1"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "#6366f1" }}
                          name="po"
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-0.5 bg-slate-300 inline-block" /> Przed
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-0.5 bg-indigo-500 inline-block" /> Po
                      </span>
                    </div>
                  </div>
                )}

                {/* Emotion frequency */}
                {analytics.emotion_frequency.length > 0 && (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                    <h2 className="font-semibold text-slate-800 text-sm">Częstość emocji</h2>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart
                        data={analytics.emotion_frequency.map((e) => ({
                          name: EMOTION_LABELS[e.emotion] ?? e.emotion,
                          value: e.count,
                        }))}
                        margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                          formatter={(val: number) => [val, "Liczba wystąpień"]}
                        />
                        <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Cognitive distortions */}
                {analytics.cognitive_distortions.length > 0 && (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                    <h2 className="font-semibold text-slate-800 text-sm">Zniekształcenia poznawcze</h2>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart
                        data={analytics.cognitive_distortions.map((d) => ({
                          name: DISTORTION_LABELS[d.distortion] ?? d.distortion,
                          value: d.count,
                        }))}
                        layout="vertical"
                        margin={{ top: 4, right: 8, left: 80, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          tick={{ fontSize: 10, fill: "#64748b" }}
                          width={80}
                        />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                          formatter={(val: number) => [val, "Liczba"]}
                        />
                        <Bar dataKey="value" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {analytics.session_count === 0 && (
                  <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                    <p className="text-sm text-slate-400">Brak danych — pacjent nie ukończył jeszcze żadnej sesji.</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

      </main>
    </div>
  );
}
