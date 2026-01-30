"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type Shift = "TAG" | "NACHT";
type Status = "LIVE" | "OFFLINE" | "PAUSE";

type StreamerId = "NOOREAX" | "VETQ";
type Streamer = { id: StreamerId; name: string; color: string };

type EventState = {
  dayCurrent: number;
  dayTotal: number;

  status: Status;

  activeStreamerId: StreamerId;
  activeShift: Shift;

  eventStartISO: string;
  nowISO: string;

  nextStreamerId: StreamerId;
  nextShift: Shift;

  plannedTimeHHMM: string;
  plannedTakeoverISO: string;

  links: { label: string; href: string }[];
};

type ShiftLogEntry = {
  id: string;
  streamerId: StreamerId;
  shift: Shift;
  startISO: string;
  endISO: string | null;
};

type StampEntry = {
  id: string;
  streamerId: StreamerId;
  stampedAtISO: string;

  plannedTakeoverISO: string;
  plannedForStreamerId: StreamerId;
  plannedShift: Shift;

  verdict: "zu früh" | "pünktlich" | "zu spät";
  deltaMin: number; // + = zu spät, - = zu früh
};

type Persisted = {
  shiftLog: ShiftLogEntry[];
  stamps: StampEntry[];

  activeStreamerId: StreamerId;
  activeShift: Shift;

  nextStreamerId: StreamerId;
  nextShift: Shift;

  plannedTimeHHMM: string;
  plannedTakeoverISO: string;
};

const LS_KEY = "grindhub_demo_state_v4";
const LS_ADMIN_KEY = "grindhub_admin_unlocked_v1";
const LS_MOD_KEY = "grindhub_mod_unlocked_v1";

// ✅ Display-Namen final
const STREAMERS: Streamer[] = [
  { id: "NOOREAX", name: "nooreax", color: "bg-violet-400" },
  { id: "VETQ", name: "Veto", color: "bg-amber-400" },
];

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}
function pad2(n: number) {
  return n.toString().padStart(2, "0");
}
function shiftLabel(shift: Shift) {
  return shift === "TAG" ? "Tagschicht" : "Nachtschicht";
}
function formatHMS(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}
function formatClock(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}
function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function formatDateKey(key: string) {
  const [y, m, d] = key.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return dt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}
function durationMs(startISO: string, endISO: string | null, nowMs: number) {
  const s = new Date(startISO).getTime();
  const e = endISO ? new Date(endISO).getTime() : nowMs;
  return Math.max(0, e - s);
}
function formatHoursMinutes(ms: number) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${pad2(m)}m`;
}
function parseHHMM(hhmm: string) {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return { h, m };
}
function localDayKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function setLocalMidnight(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function makeLocalDayKeys(eventStart: Date, now: Date) {
  const start = setLocalMidnight(eventStart);
  const end = setLocalMidnight(now);
  const out: string[] = [];
  const cur = new Date(start);
  while (cur.getTime() <= end.getTime()) {
    out.push(localDayKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
function otherStreamerId(id: StreamerId): StreamerId {
  return id === "NOOREAX" ? "VETQ" : "NOOREAX";
}
function flipShift(shift: Shift): Shift {
  return shift === "TAG" ? "NACHT" : "TAG";
}
function getStreamerName(id: StreamerId) {
  return STREAMERS.find((s) => s.id === id)?.name ?? id;
}

/**
 * Minutes-precision Verdict:
 * - beide auf Minute gerundet (Sekunden raus)
 */
function computeVerdictFixedMinute(nowMs: number, plannedMs: number) {
  const stamp = new Date(nowMs);
  stamp.setSeconds(0, 0);

  const planned = new Date(plannedMs);
  planned.setSeconds(0, 0);

  const diffMin = Math.round((stamp.getTime() - planned.getTime()) / 60000);

  if (stamp.getTime() < planned.getTime()) return { verdict: "zu früh" as const, deltaMin: diffMin };
  if (stamp.getTime() === planned.getTime()) return { verdict: "pünktlich" as const, deltaMin: 0 };
  return { verdict: "zu spät" as const, deltaMin: diffMin };
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Demo shift history
 */
function generateDemoHistory(eventStart: Date, demoNow: Date) {
  const shiftLog: ShiftLogEntry[] = [];
  const lateMap: Record<string, number> = {
    "2025-11-06_VETQ": 80,
    "2025-11-11_NOOREAX": 35,
    "2025-11-14_VETQ": 55,
  };

  const cursor = new Date(eventStart);
  cursor.setHours(11, 0, 0, 0);

  let currentStreamerId: StreamerId = "NOOREAX";
  let currentShift: Shift = "TAG";

  while (cursor.getTime() < demoNow.getTime()) {
    const start = new Date(cursor);
    const end = new Date(start.getTime() + 12 * 3600_000);

    let nextStart = new Date(end);
    if (currentShift === "TAG") {
      nextStart.setHours(23, 30, 0, 0);
      if (end.getTime() > nextStart.getTime()) nextStart = new Date(end);
    } else {
      nextStart.setHours(11, 0, 0, 0);
      if (end.getTime() > nextStart.getTime()) nextStart = new Date(end);
    }

    const nextStreamer = otherStreamerId(currentStreamerId);
    const nextDayKeyUTC = nextStart.toISOString().slice(0, 10);
    const nextLateKey = `${nextDayKeyUTC}_${nextStreamer}`;
    const nextLateMin = lateMap[nextLateKey] ?? 0;
    nextStart = new Date(nextStart.getTime() + nextLateMin * 60_000);

    const endISO = end.getTime() <= demoNow.getTime() ? end.toISOString() : null;

    shiftLog.unshift({
      id: uid("shift"),
      streamerId: currentStreamerId,
      shift: currentShift,
      startISO: start.toISOString(),
      endISO,
    });

    currentStreamerId = nextStreamer;
    currentShift = flipShift(currentShift);
    cursor.setTime(nextStart.getTime());
  }

  return shiftLog.slice(0, 160);
}

export default function Home() {
  const DEMO_EVENT_START = useMemo(() => new Date("2025-11-01T00:00:00+01:00"), []);
  const DEMO_NOW_ANCHOR = useMemo(() => new Date("2025-11-17T15:25:00+01:00"), []);

  const [nowMs, setNowMs] = useState<number>(() => DEMO_NOW_ANCHOR.getTime());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs((t) => t + 1000), 1000);
    return () => window.clearInterval(id);
  }, []);

  const [toast, setToast] = useState<string | null>(null);

  // persisted data
  const [shiftLog, setShiftLog] = useState<ShiftLogEntry[]>([]);
  const [stamps, setStamps] = useState<StampEntry[]>([]);

  const [activeStreamerId, setActiveStreamerId] = useState<StreamerId>("NOOREAX");
  const [activeShift, setActiveShift] = useState<Shift>("TAG");

  const [nextStreamerId, setNextStreamerId] = useState<StreamerId>("VETQ");
  const [nextShift, setNextShift] = useState<Shift>("NACHT");

  const [plannedTimeHHMM, setPlannedTimeHHMM] = useState<string>("14:00");
  const [plannedTakeoverISO, setPlannedTakeoverISO] = useState<string>(new Date(DEMO_NOW_ANCHOR).toISOString());

  // Admin + Mod unlock
  const ADMIN_PASS = (process.env.NEXT_PUBLIC_ADMIN_PASS ?? "devpass").trim();
  const MOD_PASS = (process.env.NEXT_PUBLIC_MOD_PASS ?? "modpass").trim();

  const [adminUnlocked, setAdminUnlocked] = useState<boolean>(false);
  const [adminInput, setAdminInput] = useState<string>("");

  const [modUnlocked, setModUnlocked] = useState<boolean>(false);
  const [modInput, setModInput] = useState<string>("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_ADMIN_KEY);
      if (saved === "1") setAdminUnlocked(true);
    } catch {}
    try {
      const savedMod = localStorage.getItem(LS_MOD_KEY);
      if (savedMod === "1") setModUnlocked(true);
    } catch {}
  }, []);

  function tryUnlock() {
    if (adminInput.trim() === ADMIN_PASS) {
      setAdminUnlocked(true);
      setAdminInput("");
      try {
        localStorage.setItem(LS_ADMIN_KEY, "1");
      } catch {}
      setToast("Admin entsperrt");
      window.setTimeout(() => setToast(null), 900);
    } else {
      setAdminInput("");
      setToast("Falsches Passwort");
      window.setTimeout(() => setToast(null), 900);
    }
  }

  function tryUnlockMod() {
    if (modInput.trim() === MOD_PASS) {
      setModUnlocked(true);
      setModInput("");
      try {
        localStorage.setItem(LS_MOD_KEY, "1");
      } catch {}
      setToast("Mod entsperrt");
      window.setTimeout(() => setToast(null), 900);
    } else {
      setModInput("");
      setToast("Falsches Mod-Passwort");
      window.setTimeout(() => setToast(null), 900);
    }
  }

  function adminLogout() {
    setAdminUnlocked(false);
    try {
      localStorage.removeItem(LS_ADMIN_KEY);
    } catch {}
    setToast("Admin gesperrt");
    window.setTimeout(() => setToast(null), 900);
  }

  const canSeeMods = adminUnlocked || modUnlocked;

  // init/load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);

      if (!raw) {
        const demoHistory = generateDemoHistory(DEMO_EVENT_START, new Date(nowMs));

        // default plan = nächstes 14:00
        const base = new Date(nowMs);
        const { h, m } = parseHHMM("14:00");
        const plan = new Date(base);
        plan.setHours(h, m, 0, 0);
        if (plan.getTime() <= nowMs) plan.setDate(plan.getDate() + 1);

        const payload: Persisted = {
          shiftLog: demoHistory,
          stamps: [],
          activeStreamerId: "NOOREAX",
          activeShift: "TAG",
          nextStreamerId: "VETQ",
          nextShift: "NACHT",
          plannedTimeHHMM: "14:00",
          plannedTakeoverISO: plan.toISOString(),
        };

        setShiftLog(payload.shiftLog);
        setStamps(payload.stamps);
        setActiveStreamerId(payload.activeStreamerId);
        setActiveShift(payload.activeShift);
        setNextStreamerId(payload.nextStreamerId);
        setNextShift(payload.nextShift);
        setPlannedTimeHHMM(payload.plannedTimeHHMM);
        setPlannedTakeoverISO(payload.plannedTakeoverISO);

        localStorage.setItem(LS_KEY, JSON.stringify(payload));
      } else {
        const parsed = JSON.parse(raw) as Partial<Persisted>;
        setShiftLog((parsed.shiftLog as any) ?? []);
        setStamps((parsed.stamps as any) ?? []);

        setActiveStreamerId((parsed.activeStreamerId as any) ?? "NOOREAX");
        setActiveShift((parsed.activeShift as any) ?? "TAG");

        setNextStreamerId((parsed.nextStreamerId as any) ?? "VETQ");
        setNextShift((parsed.nextShift as any) ?? "NACHT");

        setPlannedTimeHHMM((parsed.plannedTimeHHMM as any) ?? "14:00");
        setPlannedTakeoverISO((parsed.plannedTakeoverISO as any) ?? new Date(nowMs).toISOString());
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // persist
  useEffect(() => {
    try {
      const payload: Persisted = {
        shiftLog,
        stamps,
        activeStreamerId,
        activeShift,
        nextStreamerId,
        nextShift,
        plannedTimeHHMM,
        plannedTakeoverISO,
      };
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {}
  }, [shiftLog, stamps, activeStreamerId, activeShift, nextStreamerId, nextShift, plannedTimeHHMM, plannedTakeoverISO]);

  const eventState: EventState = useMemo(() => {
    const dayCurrent = Math.max(1, Math.floor((nowMs - DEMO_EVENT_START.getTime()) / 86400000) + 1);
    return {
      dayCurrent,
      dayTotal: 30,
      status: "LIVE",
      activeStreamerId,
      activeShift,
      eventStartISO: DEMO_EVENT_START.toISOString(),
      nowISO: new Date(nowMs).toISOString(),
      nextStreamerId,
      nextShift,
      plannedTimeHHMM,
      plannedTakeoverISO,
      links: [
        { label: "Twitch", href: "https://twitch.tv/nooreax" },
        { label: "YouTube", href: "https://youtube.com/nooreax" },
        { label: "Discord", href: "https://discord.gg/invite/92vxyw4rtF" },
        { label: "Instagram", href: "https://instagram.com/nooreax" },
        { label: "X", href: "https://x.com/nooreaxYT" },
      ],
    };
  }, [nowMs, DEMO_EVENT_START, activeStreamerId, activeShift, nextStreamerId, nextShift, plannedTimeHHMM, plannedTakeoverISO]);

  // Livezeit + Schichtdauer
  const liveMs = nowMs - new Date(eventState.eventStartISO).getTime();
  const currentShiftStartISO = useMemo(() => {
    const open = shiftLog.find((x) => x.endISO === null);
    return open?.startISO ?? shiftLog[0]?.startISO ?? eventState.eventStartISO;
  }, [shiftLog, eventState.eventStartISO]);
  const shiftMs = nowMs - new Date(currentShiftStartISO).getTime();

  // Admin: Plan speichern
  function savePlan() {
    if (!/^\d{2}:\d{2}$/.test(plannedTimeHHMM)) {
      setToast("Planzeit ungültig");
      window.setTimeout(() => setToast(null), 900);
      return;
    }

    const base = new Date(nowMs);
    const { h, m } = parseHHMM(plannedTimeHHMM);

    const plan = new Date(base);
    plan.setHours(h, m, 0, 0);
    if (plan.getTime() <= nowMs) plan.setDate(plan.getDate() + 1);

    setPlannedTakeoverISO(plan.toISOString());

    setToast("Plan gespeichert");
    window.setTimeout(() => setToast(null), 900);
  }

  // intern: takeover log
  function takeover(streamerId: StreamerId, shift: Shift) {
    setShiftLog((prev) => {
      const next = [...prev];
      const openIdx = next.findIndex((x) => x.endISO === null);
      if (openIdx >= 0) next[openIdx] = { ...next[openIdx], endISO: new Date(nowMs).toISOString() };

      next.unshift({
        id: uid("shift"),
        streamerId,
        shift,
        startISO: new Date(nowMs).toISOString(),
        endISO: null,
      });

      return next.slice(0, 200);
    });

    setActiveStreamerId(streamerId);
    setActiveShift(shift);
  }

  // Einstempeln = übernimmt exakt Plan (nextStreamerId + nextShift)
  function stampAndTakeover() {
    const plannedMs = new Date(plannedTakeoverISO).getTime();
    const { verdict, deltaMin } = computeVerdictFixedMinute(nowMs, plannedMs);

    const entry: StampEntry = {
      id: uid("stamp"),
      streamerId: nextStreamerId,
      stampedAtISO: new Date(nowMs).toISOString(),
      plannedTakeoverISO,
      plannedForStreamerId: nextStreamerId,
      plannedShift: nextShift,
      verdict,
      deltaMin,
    };

    setStamps((prev) => [entry, ...prev].slice(0, 240));

    takeover(nextStreamerId, nextShift);

    // auto-advance next
    const newNext = otherStreamerId(nextStreamerId);
    const newShift = flipShift(nextShift);
    setNextStreamerId(newNext);
    setNextShift(newShift);

    // rebase plan ISO to next occurrence of plannedTimeHHMM
    const base = new Date(nowMs);
    const { h, m } = parseHHMM(plannedTimeHHMM);
    const plan = new Date(base);
    plan.setHours(h, m, 0, 0);
    if (plan.getTime() <= nowMs) plan.setDate(plan.getDate() + 1);
    setPlannedTakeoverISO(plan.toISOString());

    setToast(
      `${getStreamerName(entry.streamerId)} übernimmt (${shiftLabel(entry.plannedShift)}) · ${entry.verdict}${
        entry.deltaMin !== 0 ? ` ${entry.deltaMin > 0 ? "+" : ""}${entry.deltaMin} Min` : ""
      }`
    );
    window.setTimeout(() => setToast(null), 1400);
  }

  // Day keys / selection
  const dayKeys = useMemo(() => makeLocalDayKeys(DEMO_EVENT_START, new Date(nowMs)), [DEMO_EVENT_START, nowMs]);
  const [selectedDay, setSelectedDay] = useState<string>("");

  useEffect(() => {
    const todayKey = localDayKey(new Date(nowMs));
    if (!selectedDay) setSelectedDay(todayKey);
    if (selectedDay && !dayKeys.includes(selectedDay)) setSelectedDay(todayKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKeys.length, nowMs]);

  // Stats: today + total
  const stats = useMemo(() => {
    const now = new Date(nowMs);
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const startTodayMs = startToday.getTime();

    const byTotal = new Map<StreamerId, number>();
    const byToday = new Map<StreamerId, number>();

    for (const e of shiftLog) {
      const msTotal = durationMs(e.startISO, e.endISO, nowMs);
      byTotal.set(e.streamerId, (byTotal.get(e.streamerId) ?? 0) + msTotal);

      const s = new Date(e.startISO).getTime();
      const eMs = e.endISO ? new Date(e.endISO).getTime() : nowMs;

      const interStart = Math.max(s, startTodayMs);
      const interEnd = Math.max(interStart, Math.min(eMs, nowMs));
      const msToday = Math.max(0, interEnd - interStart);
      if (msToday > 0) byToday.set(e.streamerId, (byToday.get(e.streamerId) ?? 0) + msToday);
    }

    const sort = (m: Map<StreamerId, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]);

    return {
      startTodayISO: startToday.toISOString(),
      today: sort(byToday),
      total: sort(byTotal),
    };
  }, [shiftLog, nowMs]);

  // Stats: selected day durations
  const statsSelectedDay = useMemo(() => {
    if (!selectedDay) return [];
    const [y, m, d] = selectedDay.split("-").map((x) => parseInt(x, 10));
    const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();

    const by = new Map<StreamerId, number>();
    for (const e of shiftLog) {
      const s = new Date(e.startISO).getTime();
      const eMs = e.endISO ? new Date(e.endISO).getTime() : nowMs;

      const interStart = Math.max(s, dayStart);
      const interEnd = Math.max(interStart, Math.min(eMs, dayEnd));
      const ms = Math.max(0, interEnd - interStart);
      if (ms > 0) by.set(e.streamerId, (by.get(e.streamerId) ?? 0) + ms);
    }

    return Array.from(by.entries()).sort((a, b) => b[1] - a[1]);
  }, [shiftLog, selectedDay, nowMs]);

  // stamps for selected day
  const stampsSelectedDay = useMemo(() => {
    if (!selectedDay) return [];
    return stamps.filter((s) => localDayKey(new Date(s.stampedAtISO)) === selectedDay);
  }, [stamps, selectedDay]);

  // Late totals + KPIs
  const lateKPIs = useMemo(() => {
    const total = stamps.length;
    const punctual = stamps.filter((s) => s.verdict === "pünktlich").length;
    const late = stamps.filter((s) => s.verdict === "zu spät" && s.deltaMin > 0);

    const punctualRate = total > 0 ? Math.round((punctual / total) * 100) : 0;
    const avgLate = late.length > 0 ? Math.round(late.reduce((a, b) => a + b.deltaMin, 0) / late.length) : 0;

    const byDay = new Map<string, number>();
    for (const s of late) {
      const dk = localDayKey(new Date(s.stampedAtISO));
      byDay.set(dk, (byDay.get(dk) ?? 0) + s.deltaMin);
    }
    const topLate = Array.from(byDay.entries()).sort((a, b) => b[1] - a[1])[0];
    const topLateDay = topLate ? { dayKey: topLate[0], mins: topLate[1] } : null;

    const sorted = [...stamps].sort(
      (a, b) => new Date(b.stampedAtISO).getTime() - new Date(a.stampedAtISO).getTime()
    );
    let streak = 0;
    for (const s of sorted) {
      if (s.verdict === "pünktlich") streak += 1;
      else break;
    }

    const byStreamer = new Map<StreamerId, number>();
    for (const s of stamps) {
      if (s.verdict === "zu spät" && s.deltaMin > 0) {
        byStreamer.set(s.streamerId, (byStreamer.get(s.streamerId) ?? 0) + s.deltaMin);
      }
    }
    const lateTotals = Array.from(byStreamer.entries()).sort((a, b) => b[1] - a[1]);

    return { punctualRate, avgLate, topLateDay, streak, lateTotals };
  }, [stamps]);

  const lastSwitches = useMemo(() => shiftLog.slice(0, 8), [shiftLog]);

  function buildPinText() {
    const stand = new Date(nowMs).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    return `LIVE 🔴 ${getStreamerName(eventState.activeStreamerId)} (${shiftLabel(
      eventState.activeShift
    )}) · Schicht ${formatHMS(shiftMs)} · Next: ${getStreamerName(eventState.nextStreamerId)} ${
      eventState.plannedTimeHHMM
    } · Stand ${stand}`;
  }

  function buildDiscordText() {
    const stand = new Date(nowMs).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    return (
      `**Status (Stand ${stand})**\n` +
      `• Aktuell: ${getStreamerName(eventState.activeStreamerId)} (${shiftLabel(eventState.activeShift)})\n` +
      `• Schichtdauer: ${formatHMS(shiftMs)}\n` +
      `• Next: ${getStreamerName(eventState.nextStreamerId)} · ${eventState.plannedTimeHHMM}\n`
    );
  }

  async function copy(text: string) {
    const ok = await copyToClipboard(text);
    setToast(ok ? "Kopiert" : "Copy failed");
    window.setTimeout(() => setToast(null), 900);
  }

  const demoNowStr = useMemo(() => {
    const d = new Date(nowMs);
    return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }, [nowMs]);

  return (
    <div className="min-h-screen text-zinc-100">
      {/* Background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950 via-zinc-950 to-sky-950" />
        <div className="absolute -top-52 left-[-140px] h-[520px] w-[520px] rounded-full bg-emerald-400/28 blur-[120px]" />
        <div className="absolute top-16 right-[-180px] h-[560px] w-[560px] rounded-full bg-amber-400/22 blur-[140px]" />
        <div className="absolute bottom-[-220px] left-1/2 h-[640px] w-[640px] -translate-x-1/2 rounded-full bg-sky-400/22 blur-[160px]" />
        <div className="absolute inset-0 bg-black/30" />
      </div>

      {toast && (
        <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-full border border-white/10 bg-black/40 px-4 py-2 text-xs text-zinc-100 backdrop-blur">
          {toast}
        </div>
      )}

      {/* Admin/Mod unlock input: unten rechts */}
      {!adminUnlocked && (
        <div className="fixed bottom-3 right-3 z-50 w-44 space-y-2">
          <input
            type="password"
            value={adminInput}
            onChange={(e) => setAdminInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") tryUnlock();
            }}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-100/90 outline-none backdrop-blur placeholder:text-zinc-100/35"
            placeholder="admin"
          />

          {!modUnlocked && (
            <input
              type="password"
              value={modInput}
              onChange={(e) => setModInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") tryUnlockMod();
              }}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-100/90 outline-none backdrop-blur placeholder:text-zinc-100/35"
              placeholder="mod"
            />
          )}
        </div>
      )}

      <main className="mx-auto flex max-w-5xl flex-col items-center gap-10 px-6 py-12 sm:px-10 sm:py-14">
        {/* Header */}
        <header className="flex flex-col items-center gap-3">
          <Image
            src="/craftattack13-fixed.png"
            alt="CraftAttack 13"
            width={620}
            height={260}
            priority
            className="drop-shadow-[0_25px_80px_rgba(0,0,0,0.65)]"
          />
          <div className="text-sm text-zinc-100/85">
            Tag <span className="text-zinc-100 font-semibold">{eventState.dayCurrent}</span> /{" "}
            <span className="text-zinc-100 font-semibold">{eventState.dayTotal}</span>
            <span className="ml-3 text-zinc-100/55">· Demo-Zeit: {demoNowStr}</span>
          </div>
        </header>

        {/* MAIN */}
        <section className="w-full rounded-3xl border border-white/10 bg-white/6 p-8 backdrop-blur-xl">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            {/* Aktuell */}
            <div className="flex flex-col gap-2">
              <div className="text-sm text-zinc-100/70">Aktuell</div>

              <div className="flex items-center gap-3">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    STREAMERS.find((s) => s.id === eventState.activeStreamerId)?.color ?? "bg-zinc-400"
                  }`}
                />
                <div className="text-2xl font-semibold tracking-tight">
                  {getStreamerName(eventState.activeStreamerId)} — {shiftLabel(eventState.activeShift)}
                </div>
              </div>

              <div className="text-sm text-zinc-100/70 flex items-center gap-2">
                Status: <span className="text-zinc-100 font-medium">Live</span>
                <span className="relative inline-flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </span>
              </div>

              <div className="text-sm text-zinc-100/70">
                Schicht läuft seit: <span className="font-minecraft text-zinc-100/90">{formatHMS(shiftMs)}</span>
              </div>
            </div>

            {/* Livezeit */}
            <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-center min-w-[280px]">
              <div className="text-xs uppercase tracking-[0.25em] text-zinc-100/60">LIVEZEIT</div>
              <div className="mt-2 text-4xl font-minecraft">{formatHMS(liveMs)}</div>
            </div>
          </div>

          {/* Nächster Wechsel */}
          <div className="mt-8 rounded-2xl border border-white/10 bg-black/15 p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm text-zinc-100/70">Nächster Wechsel</div>
                <div className="mt-1 text-lg font-medium">
                  {getStreamerName(eventState.nextStreamerId)} — {shiftLabel(eventState.nextShift)}
                </div>
              </div>
              <div className="text-sm text-zinc-100/70">
                geplant <span className="text-zinc-100 font-medium">{eventState.plannedTimeHHMM}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Admin-only */}
        {adminUnlocked && (
          <section className="w-full rounded-3xl border border-white/10 bg-white/6 p-8 backdrop-blur-xl">
            <div>
              <div className="text-sm text-zinc-100/70">Streamer-Einstellungen</div>
              <div className="mt-1 text-xl font-semibold tracking-tight">Einstempeln</div>
            </div>

            <div className="mt-6">
              <button
                onClick={adminLogout}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
              >
                Admin sperren
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-5">
              <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
                <div>
                  <div className="text-xs text-zinc-100/55 mb-2">Nächster</div>
                  <select
                    value={nextStreamerId}
                    onChange={(e) => setNextStreamerId(e.target.value as StreamerId)}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100/95 outline-none hover:bg-black/50"
                  >
                    {STREAMERS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="text-xs text-zinc-100/55 mb-2">Schicht</div>
                  <select
                    value={nextShift}
                    onChange={(e) => setNextShift(e.target.value as Shift)}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100/95 outline-none hover:bg-black/50"
                  >
                    <option value="TAG">Tagschicht</option>
                    <option value="NACHT">Nachtschicht</option>
                  </select>
                </div>

                <div>
                  <div className="text-xs text-zinc-100/55 mb-2">Planzeit</div>
                  <div className="flex gap-2">
                    <input
                      value={plannedTimeHHMM}
                      onChange={(e) => setPlannedTimeHHMM(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none"
                      placeholder="14:00"
                    />
                    <button
                      onClick={savePlan}
                      className="shrink-0 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
                    >
                      Speichern
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={stampAndTakeover}
                  className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
                  title="Einstempeln & übernimmt sofort"
                >
                  Einstempeln & übernehmen
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Stats */}
        <section className="w-full rounded-3xl border border-white/10 bg-white/6 p-8 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-zinc-100/70">Stats</div>
              <div className="mt-1 text-xl font-semibold tracking-tight">Übersicht</div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-100/55">Tag</span>
              <select
                value={selectedDay}
                onChange={(e) => setSelectedDay(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-100/95 outline-none hover:bg-black/50"
                title="Tag auswählen"
              >
                {dayKeys
                  .slice()
                  .reverse()
                  .map((k) => (
                    <option key={k} value={k}>
                      {formatDateKey(k)}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm text-zinc-100/70">Heute</div>
                <div className="text-xs text-zinc-100/55">{formatDate(stats.startTodayISO)}</div>
              </div>
              <div className="mt-3 space-y-2">
                {stats.today.length === 0 ? (
                  <div className="text-xs text-zinc-100/60">Keine Daten.</div>
                ) : (
                  stats.today.slice(0, 6).map(([id, ms]) => (
                    <div key={id} className="flex items-center justify-between text-sm">
                      <span className="text-zinc-100/90">{getStreamerName(id)}</span>
                      <span className="text-zinc-100/80">{formatHoursMinutes(ms)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
              <div className="text-sm text-zinc-100/70">Gesamt</div>
              <div className="mt-3 space-y-2">
                {stats.total.length === 0 ? (
                  <div className="text-xs text-zinc-100/60">Keine Daten.</div>
                ) : (
                  stats.total.slice(0, 6).map(([id, ms]) => (
                    <div key={id} className="flex items-center justify-between text-sm">
                      <span className="text-zinc-100/90">{getStreamerName(id)}</span>
                      <span className="text-zinc-100/80">{formatHoursMinutes(ms)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
              <div className="text-sm text-zinc-100/70">Pünktlichkeit</div>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-100/85">Pünktlich-Quote</span>
                  <span className="text-zinc-100/90">{lateKPIs.punctualRate}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-100/85">Avg Late</span>
                  <span className="text-zinc-100/90">{lateKPIs.avgLate} Min</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-100/85">Streak (pünktlich)</span>
                  <span className="text-zinc-100/90">{lateKPIs.streak}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-100/85">Top Late Day</span>
                  <span className="text-zinc-100/90">
                    {lateKPIs.topLateDay
                      ? `${formatDateKey(lateKPIs.topLateDay.dayKey)} +${lateKPIs.topLateDay.mins}`
                      : "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
              <div className="text-sm text-zinc-100/70">Zu spät gesamt</div>
              <div className="mt-3 space-y-2">
                {lateKPIs.lateTotals.length === 0 ? (
                  <div className="text-xs text-zinc-100/60">Noch keine Daten.</div>
                ) : (
                  lateKPIs.lateTotals.map(([id, mins]) => (
                    <div key={id} className="flex items-center justify-between text-sm">
                      <span className="text-zinc-100/90">{getStreamerName(id)}</span>
                      <span className="text-zinc-100/80">{mins} Min</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm text-zinc-100/70">Ausgewählter Tag</div>
                <div className="text-xs text-zinc-100/55">{selectedDay ? formatDateKey(selectedDay) : "—"}</div>
              </div>
              <div className="mt-3 space-y-2">
                {statsSelectedDay.length === 0 ? (
                  <div className="text-xs text-zinc-100/60">Keine Daten.</div>
                ) : (
                  statsSelectedDay.slice(0, 6).map(([id, ms]) => (
                    <div key={id} className="flex items-center justify-between text-sm">
                      <span className="text-zinc-100/90">{getStreamerName(id)}</span>
                      <span className="text-zinc-100/80">{formatHoursMinutes(ms)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
              <div className="text-sm text-zinc-100/70">Check-ins (Tag)</div>
              <div className="mt-3 space-y-2">
                {stampsSelectedDay.length === 0 ? (
                  <div className="text-xs text-zinc-100/60">Keine Einstempelungen an diesem Tag.</div>
                ) : (
                  stampsSelectedDay.slice(0, 10).map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-xl border border-white/10 bg-black/10 px-4 py-2 text-xs"
                    >
                      <span className="text-zinc-100/90">
                        {getStreamerName(s.streamerId)} · {formatDateTime(s.stampedAtISO)}
                      </span>
                      <span className="text-zinc-100/70">
                        {s.verdict}
                        {s.deltaMin !== 0 ? ` (${s.deltaMin > 0 ? "+" : ""}${s.deltaMin} Min)` : ""}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
              <div className="text-sm text-zinc-100/70">Letzte Wechsel</div>
              <div className="mt-3 space-y-2">
                {lastSwitches.length === 0 ? (
                  <div className="text-xs text-zinc-100/60">Keine Daten.</div>
                ) : (
                  lastSwitches.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between rounded-xl border border-white/10 bg-black/10 px-4 py-2 text-xs"
                    >
                      <span className="text-zinc-100/90">
                        {getStreamerName(e.streamerId)} · {shiftLabel(e.shift)}
                      </span>
                      <span className="text-zinc-100/60">
                        {formatDate(e.startISO)} {formatClock(e.startISO)}
                        {e.endISO ? `–${formatClock(e.endISO)}` : "–…"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Mods / Output (nur Mods/Admin) */}
        {canSeeMods && (
          <section className="w-full rounded-3xl border border-white/10 bg-white/6 p-8 backdrop-blur-xl">
            <div className="text-sm text-zinc-100/70">Mods / Output</div>
            <div className="mt-1 text-xl font-semibold tracking-tight">One-Click Copy</div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
                <div className="text-xs uppercase tracking-[0.25em] text-zinc-100/60">📌 Chat-Pin Text</div>
                <div className="mt-3 text-xs text-zinc-100/80 break-words">{buildPinText()}</div>
                <button
                  onClick={() => copy(buildPinText())}
                  className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  Kopieren
                </button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
                <div className="text-xs uppercase tracking-[0.25em] text-zinc-100/60">📣 Discord / Thread</div>
                <div className="mt-3 text-xs text-zinc-100/80 whitespace-pre-wrap break-words">
                  {buildDiscordText()}
                </div>
                <button
                  onClick={() => copy(buildDiscordText())}
                  className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  Kopieren
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Links + Overlay hint */}
        <section className="w-full">
          <div className="grid gap-3 sm:grid-cols-5">
            {eventState.links.map((l) => (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/6 px-5 py-4 text-sm text-zinc-100/90 backdrop-blur-xl hover:bg-white/10"
              >
                <span>{l.label}</span>
                <span className="text-zinc-100/50">↗</span>
              </a>
            ))}
          </div>

          <div className="mt-3 text-xs text-zinc-100/55">
            Overlay für OBS: <span className="font-minecraft">/overlay</span>
          </div>
        </section>
      </main>
    </div>
  );
}
