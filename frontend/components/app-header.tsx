"use client";

import Link from "next/link";

import { UserMenu } from "@/components/user-menu";

export interface HeaderUser {
  id: string;
  email: string;
  role: "therapist" | "patient" | "admin";
  first_name: string;
  display_name: string | null;
  professional_title?: string | null;
}

export function AppHeader({ user }: { user: HeaderUser }) {
  const home = user.role === "admin" ? "/admin" : "/dashboard";

  return (
    <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3 flex items-center justify-between gap-4 shrink-0">
      <div className="flex items-center gap-3 sm:gap-6 min-w-0 flex-1">
        <Link
          href={home}
          className="font-bold text-slate-800 dark:text-slate-100 text-lg shrink-0 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
        >
          Cognoscere
        </Link>
        <nav className="hidden sm:flex items-center gap-4 text-sm">
          {user.role !== "admin" && (
            <Link
              href="/dashboard"
              className="text-slate-600 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
            >
              Panel
            </Link>
          )}
          {(user.role === "patient" ||
            user.role === "therapist" ||
            user.role === "admin") && (
            <>
              <Link
                href="/daily"
                className="text-slate-600 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
              >
                Daily
              </Link>
              <Link
                href="/sessions"
                className="text-slate-600 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
              >
                Moje sesje
              </Link>
            </>
          )}
        </nav>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="hidden md:inline text-xs text-slate-500 dark:text-slate-400 max-w-[140px] truncate">
          {user.role === "therapist"
            ? "Terapeuta"
            : user.role === "patient"
              ? "Pacjent"
              : "Admin"}
        </span>
        <UserMenu user={user} />
      </div>
    </header>
  );
}
