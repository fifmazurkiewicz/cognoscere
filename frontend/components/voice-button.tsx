"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type State = "idle" | "recording" | "transcribing" | "error";

interface Props {
  onTranscription: (text: string) => void;
  disabled?: boolean;
}

export default function VoiceButton({ onTranscription, disabled }: Props) {
  const [state, setState] = useState<State>("idle");
  const [seconds, setSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      mediaRef.current?.stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function start() {
    setErrorMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(100);
      mediaRef.current = recorder;
      setState("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setState("error");
      setErrorMsg("Brak dostępu do mikrofonu");
    }
  }

  async function stop() {
    if (!mediaRef.current) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setState("transcribing");

    const recorder = mediaRef.current;
    recorder.stream.getTracks().forEach((t) => t.stop());

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    const mimeType = recorder.mimeType || "audio/webm";
    const ext = mimeType.includes("mp4") ? "m4a" : "webm";
    const blob = new Blob(chunksRef.current, { type: mimeType });

    try {
      const form = new FormData();
      form.append("audio", blob, `recording.${ext}`);
      const res = await api.post("/api/voice/transcribe", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onTranscription(res.data.text);
      setState("idle");
    } catch {
      setState("error");
      setErrorMsg("Błąd transkrypcji. Spróbuj ponownie.");
    }
  }

  function fmt(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  if (state === "idle" || state === "error") {
    return (
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          title="Nagraj wiadomość głosową"
          className="w-10 h-10 flex items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-brand-600 hover:border-brand-400 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <MicIcon />
        </button>
        {state === "error" && (
          <span className="text-xs text-red-500 text-center max-w-[80px]">{errorMsg}</span>
        )}
      </div>
    );
  }

  if (state === "recording") {
    return (
      <button
        type="button"
        onClick={stop}
        title="Zatrzymaj nagrywanie"
        className="w-10 h-10 flex items-center justify-center rounded-full bg-red-500 text-white animate-pulse hover:bg-red-600 transition relative"
      >
        <StopIcon />
        <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs text-red-600 font-mono whitespace-nowrap">
          {fmt(seconds)}
        </span>
      </button>
    );
  }

  return (
    <div className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100">
      <span className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}
