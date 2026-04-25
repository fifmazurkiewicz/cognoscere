"use client";

import { useState } from "react";

export interface SomaticEntry {
  body_region: string;
  sensation: string;
  intensity: number;
}

const REGIONS = [
  { id: "head", label: "Głowa / Czoło" },
  { id: "jaw", label: "Szczęka / Twarz" },
  { id: "throat", label: "Gardło / Szyja" },
  { id: "chest", label: "Klatka piersiowa" },
  { id: "left_shoulder", label: "Lewy bark" },
  { id: "right_shoulder", label: "Prawy bark" },
  { id: "upper_back", label: "Plecy (górne)" },
  { id: "stomach", label: "Brzuch / Żołądek" },
  { id: "lower_back", label: "Plecy (dolne)" },
  { id: "hips", label: "Biodra / Miednica" },
  { id: "arms", label: "Ręce / Dłonie" },
  { id: "legs", label: "Nogi / Stopy" },
];

const SENSATION_HINTS = [
  "ścisk", "ucisk", "ciężar", "pulsowanie", "mrowienie",
  "napięcie", "ból", "pustka", "ciepło", "zimno", "drżenie",
];

/** Dopisuje podpowiedź po przecinku; nie duplikuje tego samego słowa. */
function appendSensationHint(current: string, hint: string): string {
  const h = hint.trim();
  if (!h) return current.trim();
  const parts = current
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.includes(h.toLowerCase())) return current.trim();
  const base = current.trim();
  return base ? `${base}, ${h}` : h;
}

interface ActiveRegion {
  sensation: string;
  intensity: number;
}

interface Props {
  onChange: (entries: SomaticEntry[]) => void;
}

export default function BodyMap({ onChange }: Props) {
  const [active, setActive] = useState<Record<string, ActiveRegion>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ sensation: "", intensity: 5 });

  function openRegion(id: string) {
    const existing = active[id];
    setDraft(existing ? { ...existing } : { sensation: "", intensity: 5 });
    setEditing(id);
  }

  function saveRegion() {
    if (!editing) return;
    if (!draft.sensation.trim()) {
      removeRegion(editing);
      setEditing(null);
      return;
    }
    const next = { ...active, [editing]: { ...draft } };
    setActive(next);
    setEditing(null);
    notify(next);
  }

  function removeRegion(id: string) {
    const next = { ...active };
    delete next[id];
    setActive(next);
    notify(next);
  }

  function notify(state: Record<string, ActiveRegion>) {
    onChange(
      Object.entries(state).map(([body_region, v]) => ({
        body_region,
        sensation: v.sensation,
        intensity: v.intensity,
      }))
    );
  }

  const label = (id: string) => REGIONS.find((r) => r.id === id)?.label ?? id;

  return (
    <div className="space-y-4">
      {/* Region grid */}
      <div className="grid grid-cols-2 gap-2">
        {REGIONS.map(({ id, label: regionLabel }) => {
          const isActive = !!active[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => openRegion(id)}
              className={`text-left px-3 py-2.5 rounded-xl border text-sm transition ${
                isActive
                  ? "bg-brand-600 border-brand-500 text-white shadow-sm dark:bg-brand-600 dark:border-brand-500"
                  : "bg-white border-slate-200 text-slate-700 hover:border-brand-300 hover:bg-brand-50 dark:bg-slate-800/90 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700 dark:hover:border-brand-500/50"
              }`}
            >
              <span className="font-medium">{regionLabel}</span>
              {isActive && (
                <span className="block text-xs mt-0.5 opacity-80 truncate">
                  {active[id].sensation} · {active[id].intensity}/10
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Inline editor */}
      {editing && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4 dark:bg-slate-900 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <p className="font-medium text-slate-800 text-sm dark:text-slate-100">{label(editing)}</p>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-slate-400 hover:text-slate-600 text-xs dark:text-slate-500 dark:hover:text-slate-300"
            >
              Anuluj
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5 dark:text-slate-300">
              Jak opisałbyś to odczucie?
            </label>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
              Możesz wpisać kilka słów po przecinku albo klikać podpowiedzi — każda dopisze kolejne
              odczucie.
            </p>
            <input
              type="text"
              value={draft.sensation}
              onChange={(e) => setDraft((d) => ({ ...d, sensation: e.target.value }))}
              placeholder="np. ścisk, ucisk, napięcie…"
              autoFocus
              className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {SENSATION_HINTS.map((hint) => (
                <button
                  key={hint}
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      sensation: appendSensationHint(d.sensation, hint),
                    }))
                  }
                  className="text-xs px-2 py-1 rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-brand-50 hover:border-brand-300 transition dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:border-brand-500/40"
                >
                  + {hint}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5 dark:text-slate-300">
              Intensywność:{" "}
              <span className="text-brand-600 dark:text-brand-400 font-semibold">{draft.intensity}/10</span>
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={draft.intensity}
              onChange={(e) => setDraft((d) => ({ ...d, intensity: Number(e.target.value) }))}
              className="w-full accent-brand-500 dark:accent-brand-400"
            />
            <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              <span>Ledwo wyczuwalne</span>
              <span>Bardzo silne</span>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveRegion}
              className="flex-1 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium py-2 rounded-lg transition dark:bg-brand-600 dark:hover:bg-brand-500"
            >
              Zapisz
            </button>
            {active[editing] && (
              <button
                type="button"
                onClick={() => { removeRegion(editing); setEditing(null); }}
                className="px-4 text-sm text-red-500 hover:text-red-700 transition dark:text-red-400 dark:hover:text-red-300"
              >
                Usuń
              </button>
            )}
          </div>
        </div>
      )}

      {/* Summary of selected regions */}
      {Object.keys(active).length > 0 && !editing && (
        <div className="rounded-xl px-4 py-3 border bg-brand-50 border-brand-100 text-brand-900 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
          <p className="text-xs font-medium text-brand-700 dark:text-slate-200 mb-2">
            Zaznaczone obszary ({Object.keys(active).length}):
          </p>
          <ul className="space-y-1 list-none">
            {Object.entries(active).map(([id, v]) => (
              <li key={id} className="text-xs text-brand-800 dark:text-slate-300">
                <span className="font-medium text-brand-700 dark:text-slate-200">{label(id)}:</span>{" "}
                {v.sensation} ({v.intensity}/10)
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
