"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { isLoggedIn } from "@/lib/auth";

interface SomaticMapping {
  id: string;
  body_region: string;
  sensation: string;
  intensity: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  stage: string;
  created_at: string;
}

interface Session {
  id: string;
  status: string;
  current_stage: string;
  trigger_text: string;
  wellbeing_before: number;
  wellbeing_after: number | null;
  ai_summary: string | null;
  crisis_flag: boolean;
  created_at: string;
  completed_at: string | null;
  somatic_mappings: SomaticMapping[];
  messages: Message[];
}

const STAGE_LABELS: Record<string, string> = {
  somatic: "Mapa ciała",
  emotion_id: "Identyfikacja emocji",
  thought_excavation: "Wydobycie myśli",
  chain_challenging: "Podważenie przekonań",
  closing: "Zamknięcie",
  completed: "Ukończona",
};

const BODY_REGION_LABELS: Record<string, string> = {
  head: "Głowa / Czoło",
  jaw: "Szczęka / Twarz",
  throat: "Gardło / Szyja",
  chest: "Klatka piersiowa",
  left_shoulder: "Lewy bark",
  right_shoulder: "Prawy bark",
  upper_back: "Plecy (górne)",
  stomach: "Brzuch / Żołądek",
  lower_back: "Plecy (dolne)",
  hips: "Biodra / Miednica",
  arms: "Ręce / Dłonie",
  legs: "Nogi / Stopy",
};

const EMOTION_LABELS: Record<string, string> = {
  fear: "Strach", anger: "Złość", sadness: "Smutek",
  shame: "Wstyd", disgust: "Odraza", guilt: "Poczucie winy", anxiety: "Lęk",
};

const DISTORTION_LABELS: Record<string, string> = {
  catastrophizing: "Katastrofizacja",
  mind_reading: "Czytanie w myślach",
  personalization: "Personalizacja",
  mental_filter: "Filtr mentalny",
  all_or_nothing: "Myślenie zero-jedynkowe",
  should_statements: "Powinienem / muszę",
  emotional_reasoning: "Rozumowanie emocjonalne",
  labeling: "Etykietowanie",
};

function stageBadge(stage: string) {
  const colors: Record<string, string> = {
    emotion_id: "bg-blue-50 text-blue-700",
    thought_excavation: "bg-violet-50 text-violet-700",
    chain_challenging: "bg-amber-50 text-amber-700",
    closing: "bg-green-50 text-green-700",
    completed: "bg-green-50 text-green-700",
  };
  return colors[stage] ?? "bg-slate-100 text-slate-600";
}

function WellbeingBar({ value, max = 10 }: { value: number; max?: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-brand-500 transition-all"
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
      <span className="text-sm font-semibold text-slate-700 w-8 text-right">{value}/10</span>
    </div>
  );
}

export default function TherapistSessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [patientId, setPatientId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && !isLoggedIn()) {
      router.push("/login");
      return;
    }

    api.get(`/api/therapist/sessions/${sessionId}`)
      .then((res) => {
        setSession(res.data);
        // Try to determine patient id from URL referrer or state
        const stored = sessionStorage.getItem("therapist_patient_id");
        if (stored) setPatientId(stored);
      })
      .catch(() => router.push("/dashboard"))
      .finally(() => setLoading(false));
  }, [sessionId, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-400 text-sm">Ładowanie sesji…</p>
      </div>
    );
  }

  if (!session) return null;

  // Extract structured data from messages
  const extractedEmotions: { type: string; intensity: number }[] = [];
  let automaticThought = "";
  let coreBelief = "";
  let cognitiveDistortion = "";
  let alternativePerspective = "";

  for (const msg of session.messages) {
    if (msg.role !== "assistant") continue;
    // We don't have extracted_data in the response type — we'd need to extend the API
    // For now we show the full dialog
  }

  const wellbeingDelta =
    session.wellbeing_after !== null
      ? session.wellbeing_after - session.wellbeing_before
      : null;

  const stageGroups: Record<string, Message[]> = {};
  for (const msg of session.messages) {
    if (!stageGroups[msg.stage]) stageGroups[msg.stage] = [];
    stageGroups[msg.stage].push(msg);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => {
              if (patientId) router.push(`/patients/${patientId}`);
              else router.push("/dashboard");
            }}
            className="text-slate-400 hover:text-slate-700 text-sm transition shrink-0"
          >
            ←
          </button>
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 text-sm truncate">
              Sesja —{" "}
              {new Date(session.created_at).toLocaleDateString("pl-PL", {
                day: "numeric", month: "long", year: "numeric",
              })}
            </p>
            <p className="text-xs text-slate-400">
              {STAGE_LABELS[session.current_stage] ?? session.current_stage}
              {session.crisis_flag && (
                <span className="ml-2 text-red-600 font-medium">· Kryzys</span>
              )}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Wellbeing summary */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h2 className="font-semibold text-slate-800 text-sm">Samopoczucie</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 mb-1.5">Przed sesją</p>
              <WellbeingBar value={session.wellbeing_before} />
            </div>
            {session.wellbeing_after !== null && (
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Po sesji</p>
                <WellbeingBar value={session.wellbeing_after} />
              </div>
            )}
          </div>
          {wellbeingDelta !== null && (
            <div className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full ${
              wellbeingDelta > 0
                ? "bg-green-50 text-green-700"
                : wellbeingDelta < 0
                ? "bg-red-50 text-red-700"
                : "bg-slate-100 text-slate-600"
            }`}>
              {wellbeingDelta > 0 ? "↑" : wellbeingDelta < 0 ? "↓" : "→"}
              {" "}
              {wellbeingDelta > 0 ? `+${wellbeingDelta}` : wellbeingDelta} punktów
            </div>
          )}
        </div>

        {/* Trigger */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-2">
          <h2 className="font-semibold text-slate-800 text-sm">Opisana sytuacja</h2>
          <p className="text-sm text-slate-700 leading-relaxed">{session.trigger_text}</p>
        </div>

        {/* Somatic map */}
        {session.somatic_mappings.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <h2 className="font-semibold text-slate-800 text-sm">Mapa ciała</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {session.somatic_mappings.map((m) => (
                <div key={m.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5">
                  <div>
                    <p className="text-xs font-medium text-slate-700">
                      {BODY_REGION_LABELS[m.body_region] ?? m.body_region}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{m.sensation}</p>
                  </div>
                  <div className="ml-3 shrink-0 flex items-center gap-1">
                    <div className="h-1.5 w-16 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-500 rounded-full"
                        style={{ width: `${m.intensity * 10}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-500">{m.intensity}/10</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Summary */}
        {session.ai_summary && (
          <div className="bg-brand-50 border border-brand-100 rounded-2xl p-5 space-y-2">
            <h2 className="font-semibold text-brand-800 text-sm">Podsumowanie sesji (AI)</h2>
            <p className="text-sm text-brand-900 leading-relaxed">{session.ai_summary}</p>
          </div>
        )}

        {/* Dialog grouped by stage */}
        <div className="space-y-4">
          <h2 className="font-semibold text-slate-800 text-sm px-1">Przebieg dialogu</h2>
          {Object.entries(stageGroups).map(([stage, msgs]) => (
            <div key={stage} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className={`px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 ${stageBadge(stage)}`}>
                <span className="text-xs font-semibold">
                  {STAGE_LABELS[stage] ?? stage}
                </span>
                <span className="text-xs opacity-60">· {msgs.length} wiadomości</span>
              </div>
              <div className="p-4 space-y-3">
                {msgs.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div className={`max-w-[90%] sm:max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-brand-500 text-white rounded-br-sm"
                        : "bg-slate-100 text-slate-800 rounded-bl-sm"
                    }`}>
                      <p className="text-[10px] opacity-60 mb-1 font-medium">
                        {msg.role === "user" ? "Pacjent" : "Cognoscere"}
                      </p>
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {session.messages.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <p className="text-sm text-slate-400">Sesja nie zawiera jeszcze dialogu.</p>
          </div>
        )}

      </main>
    </div>
  );
}
