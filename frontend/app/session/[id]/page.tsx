"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import BodyMap, { SomaticEntry } from "@/components/body-map";
import { AppHeader, type HeaderUser } from "@/components/app-header";
import { api } from "@/lib/api";
import { isLoggedIn } from "@/lib/auth";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  stage: string;
  created_at: string;
  extracted_data?: Record<string, unknown>;
}

interface Session {
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

const STAGE_LABELS: Record<string, string> = {
  somatic: "Mapa ciała",
  emotion_id: "Emocje",
  thought_excavation: "Myśli",
  chain_challenging: "Podważenie",
  closing: "Zamknięcie",
  completed: "Ukończona",
};

const CHAT_STAGES = new Set(["emotion_id", "thought_excavation", "chain_challenging"]);

function StageBar({ current }: { current: string }) {
  const stages = ["somatic", "emotion_id", "thought_excavation", "chain_challenging", "closing"];
  const idx = stages.indexOf(current);
  return (
    <div className="flex items-center gap-1">
      {stages.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <div
            className={`h-1.5 rounded-full transition-all ${
              i < idx
                ? "bg-brand-500 w-8"
                : i === idx
                  ? "bg-brand-500 w-10"
                  : "bg-slate-200 dark:bg-slate-700 w-8"
            }`}
          />
          {i < stages.length - 1 && <div className="w-0" />}
        </div>
      ))}
      <span className="ml-2 text-xs text-slate-500 dark:text-slate-400 font-medium">
        {STAGE_LABELS[current] ?? current}
      </span>
    </div>
  );
}

export default function SessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [session, setSession] = useState<Session | null>(null);
  const [headerUser, setHeaderUser] = useState<HeaderUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Body map state
  const [somaticEntries, setSomaticEntries] = useState<SomaticEntry[]>([]);
  const [somaticSubmitting, setSomaticSubmitting] = useState(false);

  // Chat state
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Closing state
  const [wellbeingAfter, setWellbeingAfter] = useState(5);
  const [closingLoading, setClosingLoading] = useState(false);

  const [analysisText, setAnalysisText] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && !isLoggedIn()) {
      router.push("/login");
      return;
    }
    Promise.all([
      api.get<HeaderUser>("/api/auth/me"),
      api.get<Session>(`/api/sessions/${sessionId}`),
    ])
      .then(([me, sess]) => {
        setHeaderUser(me.data);
        setSession(sess.data);
        if (sess.data.patient_facing_analysis) {
          setAnalysisText(sess.data.patient_facing_analysis);
          setShowAnalysisPanel(true);
        }
      })
      .catch(() => router.push("/dashboard"))
      .finally(() => setLoading(false));
  }, [sessionId, router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages]);

  async function handleSomaticSubmit() {
    setSomaticSubmitting(true);
    try {
      const res = await api.post(`/api/sessions/${sessionId}/somatic`, {
        mappings: somaticEntries,
      });
      const msg: Message = {
        ...res.data.assistant_message,
        role: "assistant",
      };
      setSession((s) =>
        s
          ? {
              ...s,
              current_stage: res.data.session_stage,
              messages: [...s.messages, msg],
            }
          : s
      );
    } finally {
      setSomaticSubmitting(false);
    }
  }

  async function handleChatSend(e: React.FormEvent) {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;

    const userText = chatInput.trim();
    setChatInput("");
    setChatLoading(true);

    const optimisticMsg: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: userText,
      stage: session?.current_stage ?? "",
      created_at: new Date().toISOString(),
    };
    setSession((s) => s ? { ...s, messages: [...s.messages, optimisticMsg] } : s);

    try {
      const res = await api.post(`/api/sessions/${sessionId}/chat`, { message: userText });
      const assistMsg: Message = { ...res.data.assistant_message, role: "assistant" };

      setSession((s) => {
        if (!s) return s;
        const msgs = s.messages.filter((m) => m.id !== optimisticMsg.id);
        return {
          ...s,
          current_stage: res.data.session_stage,
          messages: [...msgs, optimisticMsg, assistMsg],
        };
      });

      if (res.data.crisis) {
        setSession((s) => s ? { ...s, status: "crisis" } : s);
      }
    } finally {
      setChatLoading(false);
    }
  }

  async function handleClose() {
    setClosingLoading(true);
    try {
      const res = await api.post(`/api/sessions/${sessionId}/close`, {
        wellbeing_after: wellbeingAfter,
      });
      setSession(res.data);
    } finally {
      setClosingLoading(false);
    }
  }

  const canRequestAnalysis =
    !!session &&
    (session.messages.some((m) => m.role === "assistant") ||
      !!(session.ai_summary && session.ai_summary.trim()));

  async function handleAnalyze() {
    setAnalysisLoading(true);
    setAnalysisError("");
    try {
      const res = await api.post<{ analysis: string; from_cache: boolean }>(
        `/api/sessions/${sessionId}/analyze`
      );
      setAnalysisText(res.data.analysis);
      setShowAnalysisPanel(true);
      setSession((prev) =>
        prev ? { ...prev, patient_facing_analysis: res.data.analysis } : prev
      );
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setAnalysisError(String(msg ?? "Nie udało się wygenerować analizy."));
    } finally {
      setAnalysisLoading(false);
    }
  }

  if (loading || !session || !headerUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-slate-400 text-sm">Ładowanie sesji…</p>
      </div>
    );
  }

  const isCrisis = session.status === "crisis";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <AppHeader user={headerUser} />
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3 flex items-center justify-between shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-4 flex-wrap">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-sm transition"
          >
            ← Dashboard
          </button>
          <StageBar current={session.current_stage} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canRequestAnalysis && (
            <>
              {!analysisText ? (
                <button
                  type="button"
                  onClick={() => void handleAnalyze()}
                  disabled={analysisLoading}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
                >
                  {analysisLoading ? "Analizuję…" : "Analizuj"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAnalysisPanel((v) => !v)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-violet-200 dark:border-violet-800 text-violet-800 dark:text-violet-200 bg-violet-50 dark:bg-violet-950/50 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
                >
                  {showAnalysisPanel ? "Ukryj analizę" : "Pokaż analizę"}
                </button>
              )}
            </>
          )}
          {isCrisis && (
            <span className="text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 px-3 py-1 rounded-full border border-red-200 dark:border-red-900">
              Tryb kryzysowy
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col max-w-2xl w-full mx-auto px-4 py-6 gap-4">

        {analysisError && (
          <div className="bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3 border border-red-200 dark:border-red-900">
            {analysisError}
          </div>
        )}

        {showAnalysisPanel && analysisText && (
          <div className="bg-violet-50/80 dark:bg-violet-950/35 rounded-xl border border-violet-200 dark:border-violet-900 px-4 py-4 space-y-2 shrink-0">
            <p className="text-xs font-semibold text-violet-900 dark:text-violet-200 uppercase tracking-wide">
              Analiza sesji
            </p>
            <div className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
              {analysisText}
            </div>
          </div>
        )}

        {/* Trigger text (always visible, collapsed) */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3">
          <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">Sytuacja</p>
          <p className="text-sm text-slate-700 dark:text-slate-200 line-clamp-2">{session.trigger_text}</p>
        </div>

        {/* ── SOMATIC STAGE ── */}
        {session.current_stage === "somatic" && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5 flex-1 overflow-y-auto">
            <div>
              <h2 className="font-semibold text-slate-800 dark:text-slate-100">Gdzie to czujesz w ciele?</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Zaznacz obszary w których coś czujesz — możesz wybrać kilka.
                Jeśli nie czujesz nic szczególnego, pomiń ten krok.
              </p>
            </div>
            <BodyMap onChange={setSomaticEntries} />
            <button
              onClick={handleSomaticSubmit}
              disabled={somaticSubmitting}
              className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium py-3 rounded-xl text-sm transition-colors"
            >
              {somaticSubmitting ? "Przetwarzanie…" : "Przejdź do rozmowy →"}
            </button>
          </div>
        )}

        {/* ── CHAT STAGES ── */}
        {(CHAT_STAGES.has(session.current_stage) || session.current_stage === "closing" || session.current_stage === "completed") &&
          session.messages.length > 0 && (
          <div className="flex-1 overflow-y-auto space-y-3 pb-2" style={{ minHeight: 0 }}>
            {session.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                    msg.role === "user"
                      ? "bg-brand-500 text-white rounded-br-sm"
                      : isCrisis && msg.stage === session.current_stage && msg.role === "assistant"
                      ? "bg-red-50 border border-red-200 text-red-800 rounded-bl-sm"
                      : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-sm"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3">
                  <div className="flex gap-1 items-center h-4">
                    <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* ── CHAT INPUT ── */}
        {CHAT_STAGES.has(session.current_stage) && !isCrisis && (
          <div className="shrink-0 space-y-2">
            <form onSubmit={handleChatSend} className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Napisz odpowiedź…"
                disabled={chatLoading}
                className="flex-1 border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
              >
                Wyślij
              </button>
            </form>
            <p className="text-xs text-slate-500 leading-snug">
              Utknąłeś na tym kroku (np. błąd asystenta)? Wyślij wiadomość:{" "}
              <span className="font-medium text-slate-600">Przejdź dalej</span> — przejdziesz do
              następnego etapu.
            </p>
          </div>
        )}

        {/* ── CRISIS ── */}
        {isCrisis && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 space-y-3 shrink-0">
            <p className="font-semibold text-red-800">Ważne numery pomocy</p>
            <ul className="text-sm text-red-700 space-y-1">
              <li><strong>116 123</strong> — Telefon Zaufania (całą dobę)</li>
              <li><strong>116 111</strong> — Telefon Zaufania dla Dzieci i Młodzieży</li>
              <li><strong>112</strong> — Pogotowie / numer alarmowy</li>
            </ul>
            <button
              onClick={() => router.push("/dashboard")}
              className="text-sm text-red-600 hover:underline"
            >
              Wróć do dashboardu
            </button>
          </div>
        )}

        {/* ── CLOSING STAGE ── */}
        {session.current_stage === "closing" && !isCrisis && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5 shrink-0">
            <div>
              <h2 className="font-semibold text-slate-800">Zakończ sesję</h2>
              {session.ai_summary && (
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                  {session.ai_summary}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Jak się teraz czujesz?{" "}
                <span className="text-brand-600 font-semibold">{wellbeingAfter}/10</span>
              </label>
              <input
                type="range"
                min={1}
                max={10}
                value={wellbeingAfter}
                onChange={(e) => setWellbeingAfter(Number(e.target.value))}
                className="w-full accent-brand-500"
              />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>1 — Bardzo źle</span>
                <span>10 — Doskonale</span>
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={closingLoading}
              className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium py-3 rounded-xl text-sm transition-colors"
            >
              {closingLoading ? "Zapisywanie…" : "Zakończ sesję"}
            </button>
          </div>
        )}

        {/* ── COMPLETED ── */}
        {session.current_stage === "completed" && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-2xl">✓</span>
              <div>
                <h2 className="font-semibold text-slate-800">Sesja zakończona</h2>
                <p className="text-xs text-slate-400">
                  Samopoczucie: {session.wellbeing_before}/10 →{" "}
                  {session.wellbeing_after ?? "—"}/10
                </p>
              </div>
            </div>
            {session.ai_summary && (
              <p className="text-sm text-slate-600 leading-relaxed">{session.ai_summary}</p>
            )}
            <button
              onClick={() => router.push("/dashboard")}
              className="w-full border border-brand-500 text-brand-600 hover:bg-brand-50 font-medium py-2.5 rounded-xl text-sm transition-colors"
            >
              Wróć do dashboardu
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
