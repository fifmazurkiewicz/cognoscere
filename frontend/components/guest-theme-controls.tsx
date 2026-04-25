"use client";

import { useTheme } from "@/components/theme-provider";

/** Przyciski motywu na stronach logowania / rejestracji (bez menu konta). */
export function GuestThemeControls() {
  const { theme, setTheme, resolved } = useTheme();

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 backdrop-blur px-2 py-2 shadow-lg">
      <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 px-1">
        Motyw
      </span>
      <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 gap-0.5">
        {(["light", "dark", "system"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTheme(t)}
            className={`px-2 py-1 rounded-md text-xs font-medium transition ${
              theme === t
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow"
                : "text-slate-600 dark:text-slate-400"
            }`}
          >
            {t === "light" ? "Jasny" : t === "dark" ? "Ciemny" : "Auto"}
          </button>
        ))}
      </div>
      <span className="text-[10px] text-slate-400 px-1">
        {resolved === "dark" ? "Ciemny widok" : "Jasny widok"}
      </span>
    </div>
  );
}
