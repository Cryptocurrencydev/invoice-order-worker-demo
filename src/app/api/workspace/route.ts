import { NextResponse } from "next/server";
import { currentWs } from "@/lib/ws";
import { q } from "@/lib/db";

/** Clears this browser's demo workspace (invoices, orders, questions). Customers are shared and kept. */
export async function DELETE() {
  const ws = await currentWs();
  if (!ws) return NextResponse.json({ ok: true });
  await q("delete from invoices where ws = $1", [ws]);
  await q("delete from orders where ws = $1", [ws]);
  await q("delete from answers where ws = $1", [ws]);
  await q("delete from questions where ws = $1", [ws]);
  return NextResponse.json({ ok: true });
}
