"use client";

import { useEffect, useMemo, useState } from "react";

type Shift = "TAG" | "NACHT";
type StreamerId = "NOOREAX" | "VETQ";

type ShiftLogEntry = {
  startISO: string;
  endISO: string | null; // null = läuft
};

type Persisted = {
  activeStreamerId: StreamerId;
  activeShift: Shift;

  nextStreamerId: StreamerId;
  nextShift: Shift;

  plannedTimeHHMM: string;

  shiftLog: ShiftLogEntry[];
};

const LS_KEY = "grindhub_demo_state_v4";

const NAME: Record<StreamerId, string> = {
  NOOREAX: "nooreax",
  VETQ: "Veto",
};

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

function formatHMS(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function shiftLabel(shift: Shift) {
  return shift === "TAG" ? "Tagschicht" : "Nachtschicht";
}

export default function OverlayPage() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const [state, setState] = useState<Persisted | null>(null);

  // Poll localStorage, damit Overlay live mitzieht
  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return setState(null);
        setState(JSON.parse(raw));
      } catch {
        setState(null);
      }
    };

    read();
    const id = window.setInterval(read, 500);
    return () => window.clearInterval(id);
  }, []);

  const activeId = state?.activeStreamerId ?? "NOOREAX";
  const activeShift = state?.activeShift ?? "TAG";
  const nextId = state?.nextStreamerId ?? "VETQ";
  const nextShift = state?.nextShift ?? "NACHT";
  const planned = state?.plannedTimeHHMM ?? "--:--";

  const currentShiftStartISO = useMemo(() => {
    const open = state?.shiftLog?.find((x) => x.endISO === null);
    return open?.startISO ?? null;
  }, [state]);

  const shiftMs = currentShiftStartISO
    ? nowMs - new Date(currentShiftStartISO).getTime()
    : 0;

  return (
    <div className="min-h-screen bg-transparent text-white">
      <div className="p-4">
        <div className="inline-flex items-center gap-3 rounded-2xl border border-white/15 bg-black/35 px-4 py-3 backdrop-blur-xl">
          {/* Live Dot (subtil) */}
          <span className="relative inline-flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>

          {/* Aktuell */}
          <span className="text-base font-semibold">{NAME[activeId]}</span>

          <span className="text-white/60">·</span>

          <span className="text-sm text-white/85">{shiftLabel(activeShift)}</span>

          <span className="text-white/60">·</span>

          {/* Schichtdauer (Minecraft Font) */}
          <span className="font-minecraft text-base">{formatHMS(shiftMs)}</span>

          <span className="text-white/60">·</span>

          {/* Next */}
          <span className="text-sm text-white/85">
            Next: <span className="font-medium text-white">{NAME[nextId]}</span>{" "}
            <span className="text-white/60">({shiftLabel(nextShift)})</span>{" "}
            <span className="text-white/80">{planned}</span>
          </span>
        </div>

        {!state && (
          <div className="mt-2 text-xs text-white/55">
            Kein State gefunden. Erst die Hauptseite öffnen, damit localStorage
            gesetzt ist.
          </div>
        )}
      </div>
    </div>
  );
}
