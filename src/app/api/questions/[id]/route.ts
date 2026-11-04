import { NextResponse } from "next/server";
import { currentWs } from "@/lib/ws";
import { answerQuestion } from "@/lib/worker/pipeline";
import { workerDeps } from "@/lib/worker/deps";

export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await currentWs();
  const body = (await req.json().catch(() => null)) as { answer?: string; by?: string } | null;
  const answer = body?.answer?.trim();
  if (!ws || !answer) return NextResponse.json({ error: "answer required" }, { status: 400 });
  const by = (body?.by?.trim() || "Salesperson").slice(0, 60);
  try {
    const r = await answerQuestion((await params).id, ws, answer, by, workerDeps());
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 409 });
  }
}
