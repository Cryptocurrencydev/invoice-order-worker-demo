import { NextResponse } from "next/server";
import { currentWs } from "@/lib/ws";
import { getInvoiceState } from "@/lib/state";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await currentWs();
  const state = ws ? await getInvoiceState(ws, (await params).id) : null;
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(state, { headers: { "cache-control": "no-store" } });
}
