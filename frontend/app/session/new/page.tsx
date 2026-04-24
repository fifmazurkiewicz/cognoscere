"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/api";
import { isLoggedIn } from "@/lib/auth";

export default function NewSessionPage() {
  const router = useRouter();
  const [triggerText, setTriggerText] = useState("");
  const [wellbeingBefore, setWellbeingBefore] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (typeof window !== "undefined" && !isLoggedIn()) {
    router.push("/login");
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/api/sessions", {
        trigger_text: triggerText,
        wellbeing_before: wellbeingBefore,
      });
      router.push(`/session/${res.data.id}`);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(msg ?? "Nie udało się rozpocząć sesji.");
      setLoading(false);
    }
  }

  const wellbeingLabels: Record<number, string> = {
    1: "Bardzo źle", 2: "Źle", 3: "Niezbyt dobrze", 4: "Poniżej przeciętnej",
    5: "Przeciętnie", 6: "Całkiem dobrze", 7: "Dobrze", 8: "Bardzo dobrze",
    9: "Świetnie", 10: "Doskonale",
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-slate-400 hover:text-slate-700 text-sm transition"
        >
          ← Wróć
        </button>
        <span className="font-semibold text-slate-800">Nowa sesja</span>
      </header>

      <main className="max-w-xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800">Co się wydarzyło?</h1>
          <p className="text-slate-500 text-sm mt-2">
            Opisz sytuację która Cię poruszyła — nie musisz tego robić perfekcyjnie.
            Kilka zdań wystarczy.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Opisz sytuację
            </label>
            <textarea
              value={triggerText}
              onChange={(e) => setTriggerText(e.target.value)}
              required
              minLength={5}
              rows={5}
              placeholder="Np. Przed rozmową o pracę siedziałem w samochodzie i poczułem się bardzo źle. Nie mogłem się skupić, serce mi waliło…"
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition resize-none"
            />
            <p className="text-xs text-slate-400">{triggerText.length} / 2000 znaków</p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              Jak się teraz czujesz?{" "}
              <span className="text-brand-600 font-semibold">
                {wellbeingBefore}/10 — {wellbeingLabels[wellbeingBefore]}
              </span>
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={wellbeingBefore}
              onChange={(e) => setWellbeingBefore(Number(e.target.value))}
              className="w-full accent-brand-500"
            />
            <div className="flex justify-between text-xs text-slate-400">
              <span>1 — Bardzo źle</span>
              <span>10 — Doskonale</span>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded-xl px-4 py-3 border border-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || triggerText.trim().length < 5}
            className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl text-sm transition-colors"
          >
            {loading ? "Rozpoczynanie sesji…" : "Przejdź do mapy ciała →"}
          </button>
        </form>
      </main>
    </div>
  );
}
