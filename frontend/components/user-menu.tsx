"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { HeaderUser } from "@/components/app-header";
import { useTheme, type ThemePreference } from "@/components/theme-provider";
import { clearTokens } from "@/lib/auth";

export function UserMenu({ user }: { user: HeaderUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { theme, setTheme, resolved } = useTheme();

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const initial = (
    user.display_name?.[0] ??
    user.first_name?.[0] ??
    user.email?.[0] ??
    "?"
  ).toUpperCase();

  function logout() {
    clearTokens();
    router.push("/login");
  }

  function pickTheme(t: ThemePreference) {
    setTheme(t);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Menu konta"
      >
        <span className="w-9 h-9 rounded-full bg-brand-500 text-white text-sm font-semibold flex items-center justify-center shadow-sm">
          {initial}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl py-2 z-[100] text-sm">
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
            <p className="font-medium text-slate-800 dark:text-slate-100 truncate">
              {user.display_name ?? user.first_name}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
          </div>
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
              Motyw strony
            </p>
            <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 gap-0.5">
              {(["light", "dark", "system"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => pickTheme(t)}
                  className={`flex-1 py-1.5 rounded-md text-xs font-medium transition ${
                    theme === t
                      ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  {t === "light" ? "Jasny" : t === "dark" ? "Ciemny" : "System"}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
              Wyświetlanie: {resolved === "dark" ? "ciemne" : "jasne"}
            </p>
          </div>
          <Link
            href="/settings"
            className="block px-3 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            onClick={() => setOpen(false)}
          >
            Ustawienia konta (hasło, usuń konto)
          </Link>
          <button
            type="button"
            onClick={logout}
            className="w-full text-left px-3 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Wyloguj
          </button>
        </div>
      )}
    </div>
  );
}
