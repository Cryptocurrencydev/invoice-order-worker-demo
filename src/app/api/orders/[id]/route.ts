import { NextResponse } from "next/server";
import { currentWs } from "@/lib/ws";
import { reviewOrder } from "@/lib/worker/pipeline";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await currentWs();
  const body = (await req.json().catch(() => null)) as { action?: string; note?: string; by?: string } | null;
  if (!ws || (body?.action !== "approve" && body?.action !== "send_back")) return NextResponse.json({ error: "action must be approve or send_back" }, { status: 400 });
  const note = body.note?.trim().slice(0, 500) || null;
  if (body.action === "send_back" && !note) return NextResponse.json({ error: "say why it's being sent back" }, { status: 400 });
  try {
    return NextResponse.json(await reviewOrder(ws, (await params).id, body.action, (body.by?.trim() || "Office").slice(0, 60), note));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 409 });
  }
}
