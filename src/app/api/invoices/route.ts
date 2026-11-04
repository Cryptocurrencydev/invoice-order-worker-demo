import { after, NextResponse } from "next/server";
import { currentWs } from "@/lib/ws";
import { createInvoice, processInvoice } from "@/lib/worker/pipeline";
import { workerDeps } from "@/lib/worker/deps";
import { listInvoices } from "@/lib/state";

export const maxDuration = 300;

export async function POST(req: Request) {
  const ws = await currentWs();
  if (!ws) return NextResponse.json({ error: "no workspace cookie; reload the page" }, { status: 400 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "attach a PDF as 'file'" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "PDF too large (max 8 MB)" }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (Buffer.from(bytes.slice(0, 5)).toString() !== "%PDF-") return NextResponse.json({ error: "that file is not a PDF" }, { status: 415 });
  const id = await createInvoice(ws, file.name.slice(0, 120) || "invoice.pdf", bytes);
  after(() => processInvoice(id, workerDeps()));
  return NextResponse.json({ id }, { status: 201 });
}

export async function GET() {
  const ws = await currentWs();
  return NextResponse.json({ invoices: ws ? await listInvoices(ws) : [] });
}
