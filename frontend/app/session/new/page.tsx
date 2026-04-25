"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppHeader, type HeaderUser } from "@/components/app-header";
import { api } from "@/lib/api";
import { clearTokens, isLoggedIn } from "@/lib/auth";

export default function NewSessionPage() {
  const router = useRouter();
  const [user, setUser] = useState<HeaderUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [triggerText, setTriggerText] = useState("");
  const [wellbeingBefore, setWellbeingBefore] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }
    api
      .get<HeaderUser>("/api/auth/me")
      .then((res) => {
        if (
          res.data.role !== "patient" &&
          res.data.role !== "therapist" &&
          res.data.role !== "admin"
        ) {
          router.replace("/dashboard");
          return;
        }
        setUser(res.data);
      })
      .catch(() => {
        clearTokens();
        router.replace("/login");
      })
      .finally(() => setBooting(false));
  }, [router]);

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
    1: "Bardzo źle",
    2: "Źle",
    3: "Niezbyt dobrze",
    4: "Poniżej przeciętnej",
    5: "Przeciętnie",
    6: "Całkiem dobrze",
    7: "Dobrze",
    8: "Bardzo dobrze",
    9: "Świetnie",
    10: "Doskonale",
  };

  if (booting || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-slate-400 text-sm">Ładowanie…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <AppHeader user={user} />
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3 flex items-center gap-4">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-sm transition"
        >
          ← Wróć
        </button>
        <span className="font-semibold text-slate-800 dark:text-slate-100">Nowa sesja</span>
      </header>

      <main className="max-w-xl mx-auto px-4 sm:px-6 py-10 w-full flex-1">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Co się wydarzyło?</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">
            Opisz sytuację która Cię poruszyła — nie musisz tego robić perfekcyjnie. Kilka zdań
            wystarczy.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Opisz sytuację
            </label>
            <textarea
              value={triggerText}
              onChange={(e) => setTriggerText(e.target.value)}
              required
              minLength={5}
              rows={5}
              placeholder="Np. Przed rozmową o pracę siedziałem w samochodzie i poczułem się bardzo źle. Nie mogłem się skupić, serce mi waliło…"
              className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-950 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition resize-none"
            />
            <p className="text-xs text-slate-400">{triggerText.length} / 2000 znaków</p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-3">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Jak się teraz czujesz?{" "}
              <span className="text-brand-600 dark:text-brand-400 font-semibold">
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
            <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500">
              <span>1 — Bardzo źle</span>
              <span>10 — Doskonale</span>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3 border border-red-200 dark:border-red-900">
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
