import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const STATE_PATH = path.join(process.cwd(), "data", "state.json");

type Shift = "TAG" | "NACHT";
type TimeWindow = { from: string; to: string };

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

async function readState() {
  const raw = await fs.readFile(STATE_PATH, "utf-8");
  return JSON.parse(raw);
}

async function writeState(state: any) {
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

function authOk(req: Request) {
  const token = req.headers.get("x-admin-token") ?? "";
  const expected = process.env.ADMIN_TOKEN ?? "";
  return expected.length > 0 && token === expected;
}

function parseHHMM(s: string) {
  // very light validation
  return /^\d{2}:\d{2}$/.test(s);
}

export async function POST(req: Request) {
  if (!authOk(req)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }

  const { action } = body ?? {};
  const nowISO = new Date().toISOString();

  try {
    const state = await readState();

    if (action === "setExpectedWindow") {
      const w: TimeWindow = body?.expectedWindow;
      if (!w || !parseHHMM(w.from) || !parseHHMM(w.to)) {
        return NextResponse.json({ error: "BAD_WINDOW" }, { status: 400 });
      }
      state.expectedWindow = { from: w.from, to: w.to };
      await writeState(state);
      return NextResponse.json({ ok: true, state }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "takeover") {
      const streamer: string = body?.streamer;
      const shift: Shift = body?.shift;

      if (!streamer || (shift !== "TAG" && shift !== "NACHT")) {
        return NextResponse.json({ error: "BAD_TAKEOVER" }, { status: 400 });
      }

      // close open shift
      const openIdx = (state.shiftLog ?? []).findIndex((x: any) => x.endISO === null);
      if (openIdx >= 0) state.shiftLog[openIdx].endISO = nowISO;

      // prepend new shift
      state.shiftLog = [
        {
          id: uid("shift"),
          streamer,
          shift,
          startISO: nowISO,
          endISO: null,
        },
        ...(state.shiftLog ?? []),
      ].slice(0, 200);

      state.activeStreamer = streamer;
      state.activeShift = shift;

      // simple auto-next flip (MVP)
      if (streamer.toUpperCase().includes("NOOREAX")) {
        state.nextStreamer = "VETQ";
        state.nextShift = "NACHT";
      } else {
        state.nextStreamer = "NOOREAX";
        state.nextShift = "TAG";
      }

      await writeState(state);
      return NextResponse.json({ ok: true, state }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "stamp") {
      const streamer: string = body?.streamer;
      if (!streamer) return NextResponse.json({ error: "BAD_STAMP" }, { status: 400 });

      // stamp entry (verdict calc happens client-side for demo; server just stores stamp time)
      state.stamps = [
        {
          id: uid("stamp"),
          streamer,
          stampedAtISO: nowISO,
          expectedWindow: state.expectedWindow ?? null,
        },
        ...(state.stamps ?? []),
      ].slice(0, 50);

      await writeState(state);
      return NextResponse.json({ ok: true, state }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json(
      { error: "ADMIN_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
