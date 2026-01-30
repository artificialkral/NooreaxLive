import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const STATE_PATH = path.join(process.cwd(), "data", "state.json");

async function readState() {
  const raw = await fs.readFile(STATE_PATH, "utf-8");
  return JSON.parse(raw);
}

export async function GET() {
  try {
    const state = await readState();
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { error: "STATE_READ_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
