import { currentWs } from "@/lib/ws";
import { one } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await currentWs();
  const { id } = await params;
  if (!ws || !/^[0-9a-f-]{36}$/.test(id)) return new Response("not found", { status: 404 });
  const r = await one<{ pdf: Buffer; file_name: string }>("select pdf, file_name from invoices where id = $1 and ws = $2", [id, ws]);
  if (!r) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(r.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${r.file_name.replace(/[^\w.-]/g, "_")}"` } });
}
