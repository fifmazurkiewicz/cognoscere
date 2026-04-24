"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import BodyMap, { SomaticEntry } from "@/components/body-map";
import { api } from "@/lib/api";
import { isLoggedIn } from "@/lib/auth";

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

const STAGE_ORDER = ["somatic", "emotion_id", "thought_excavation", "chain_challenging", "closing", "completed"];
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
              i < idx ? "bg-brand-500 w-8" : i === idx ? "bg-brand-500 w-10" : "bg-slate-200 w-8"
            }`}
          />
          {i < stages.length - 1 && <div className="w-0" />}
        </div>
      ))}
      <span className="ml-2 text-xs text-slate-500 font-medium">
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

  useEffect(() => {
    if (typeof window !== "undefined" && !isLoggedIn()) {
      router.push("/login");
      return;
    }
    api.get(`/api/sessions/${sessionId}`)
      .then((res) => setSession(res.data))
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-400 text-sm">Ładowanie sesji…</p>
      </div>
    );
  }

  if (!session) return null;

  const isCrisis = session.status === "crisis";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-slate-400 hover:text-slate-700 text-sm transition"
          >
            ← Dashboard
          </button>
          <StageBar current={session.current_stage} />
        </div>
        {isCrisis && (
          <span className="text-xs font-medium text-red-600 bg-red-50 px-3 py-1 rounded-full border border-red-200">
            Tryb kryzysowy
          </span>
        )}
      </header>

      <div className="flex-1 overflow-hidden flex flex-col max-w-2xl w-full mx-auto px-4 py-6 gap-4">

        {/* Trigger text (always visible, collapsed) */}
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
          <p className="text-xs font-medium text-slate-400 mb-1">Sytuacja</p>
          <p className="text-sm text-slate-700 line-clamp-2">{session.trigger_text}</p>
        </div>

        {/* ── SOMATIC STAGE ── */}
        {session.current_stage === "somatic" && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 flex-1 overflow-y-auto">
            <div>
              <h2 className="font-semibold text-slate-800">Gdzie to czujesz w ciele?</h2>
              <p className="text-sm text-slate-500 mt-1">
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
                      : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm"
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
          <form onSubmit={handleChatSend} className="flex gap-2 shrink-0">
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
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shrink-0">
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
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shrink-0">
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
