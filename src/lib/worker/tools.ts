// The app functions the model may call. Every write goes through here, is guarded by
// deterministic checks, and is read back and compared with what was intended.
import type Anthropic from "@anthropic-ai/sdk";
import { one, q } from "../db";
import { findProduct, supplierByCode } from "../catalog";
import { normInvoiceNo } from "./fingerprint";
import { invoiceLines, resolveLine, type ResolvedLine } from "./resolve";
import { LINE_FIELDS, type LineValues } from "./types";

export interface ToolContext {
  ws: string;
  stage: string;
  invoice: { id: string; supplier: string; invoice_no: string; sidemark: string | null };
  /** test hook: simulate a faulty write path (e.g. a column that rounds or truncates) */
  faults?: { mutateRow?: (row: LineValues) => LineValues };
}

type ToolResult = { ok: boolean; [k: string]: unknown };

const obj = (properties: Record<string, unknown>) => ({ type: "object" as const, additionalProperties: false, required: Object.keys(properties), properties });
const s = (description: string) => ({ type: "string", description });

export const TOOL_DEFS: Anthropic.Beta.Messages.BetaTool[] = [
  { name: "find_customer", strict: true, description: "Search customers by name and/or job number (e.g. 'OKAFOR J-2201'). Returns matching customers with ids.", input_schema: obj({ query: s("name and/or job number from the invoice sidemark") }) },
  { name: "find_order", strict: true, description: "Find the existing customer order created from this supplier invoice number, if any. Always check before creating an order.", input_schema: obj({ supplier: s("supplier code, e.g. NFS"), invoice_number: s("invoice number as printed") }) },
  { name: "create_order", strict: true, description: "Create the customer order for this invoice. Fails if the customer does not match the invoice sidemark. Returns the existing order if one already exists for this invoice.", input_schema: obj({ customer_id: s("customer id from find_customer"), supplier: s("supplier code"), invoice_number: s("invoice number as printed") }) },
  { name: "add_or_update_line", strict: true, description: "Write one invoice line to the order. The app supplies the validated values for the line_key; the saved line is read back and verified. Idempotent: calling again updates the same line.", input_schema: obj({ order_id: s("order id"), line_key: s("line_key from the invoice summary") }) },
  { name: "set_status_for_review", strict: true, description: "Hand the order to the office review queue. Only succeeds when every invoice line is on the order, complete, and verified.", input_schema: obj({ order_id: s("order id") }) },
];

export const LINE_COLUMNS = LINE_FIELDS.join(", ");

function sameValue(a: unknown, b: unknown) {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}

export function compareLine(intended: LineValues, saved: Record<string, unknown>) {
  return LINE_FIELDS.filter((f) => !sameValue((intended as unknown as Record<string, unknown>)[f], saved[f])).map((f) => ({
    field: f,
    intended: (intended as unknown as Record<string, unknown>)[f] ?? null,
    saved: saved[f] ?? null,
  }));
}

async function orderForInvoice(ctx: ToolContext, orderId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return { error: `order ${orderId} not found` };
  const o = await one<{ id: string; supplier: string; invoice_no_norm: string; status: string; order_no: string }>("select id, supplier, invoice_no_norm, status, order_no from orders where id = $1 and ws = $2", [orderId, ctx.ws]);
  if (!o) return { error: `order ${orderId} not found` };
  if (o.supplier !== ctx.invoice.supplier || o.invoice_no_norm !== normInvoiceNo(ctx.invoice.invoice_no))
    return { error: `order ${o.order_no} belongs to a different invoice; this worker may only write the order for ${ctx.invoice.supplier} ${ctx.invoice.invoice_no}` };
  return { order: o };
}

async function writeAndVerify(ctx: ToolContext, orderId: string, r: ResolvedLine) {
  const supplier = supplierByCode(ctx.invoice.supplier)!;
  const v = ctx.faults?.mutateRow ? ctx.faults.mutateRow({ ...r.values }) : r.values;
  const status = r.issues.length ? "needs_info" : "complete";
  const productName = findProduct(supplier, r.values.sku)?.name ?? null;
  const before = await one<{ id: string; order_id: string }>("select id, order_id from order_lines where ws = $1 and line_key = $2", [ctx.ws, r.line_key]);
  if (before && before.order_id !== orderId) return { ok: false, error: `line ${r.line_key} already belongs to another order` };
  const row = await one<{ id: string }>(
    `insert into order_lines (ws, order_id, line_key, line_no, status, product_name, provenance, ${LINE_COLUMNS})
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     on conflict (ws, line_key) do update set status = excluded.status, product_name = excluded.product_name, provenance = excluded.provenance,
       ${LINE_FIELDS.map((f) => `${f} = excluded.${f}`).join(", ")}, verified_ok = false, updated_at = now()
     where order_lines.order_id = excluded.order_id
     returning id`,
    [ctx.ws, orderId, r.line_key, r.line_no, status, productName, JSON.stringify(r.provenance), ...LINE_FIELDS.map((f) => (v as unknown as Record<string, unknown>)[f])],
  );
  if (!row) return { ok: false, error: `line ${r.line_key} could not be written` };
  // read back in a separate query and compare with what the worker intended to save
  const saved = await one<Record<string, unknown>>(`select ${LINE_COLUMNS} from order_lines where id = $1`, [row.id]);
  const mismatches = compareLine(r.values, saved ?? {});
  const ok = mismatches.length === 0;
  await q("insert into verifications (ws, invoice_id, order_line_id, intended, saved, mismatches, ok) values ($1,$2,$3,$4,$5,$6,$7)", [ctx.ws, ctx.invoice.id, row.id, JSON.stringify(r.values), JSON.stringify(saved), JSON.stringify(mismatches), ok]);
  await q("update order_lines set verified_ok = $2, verified_at = now() where id = $1", [row.id, ok]);
  if (!ok) {
    await q("update orders set status = 'blocked', updated_at = now() where id = $1", [orderId]);
    await event(ctx, orderId, "verify_failed", `Read-back mismatch on line ${r.line_no}: ${mismatches.map((m) => `${m.field} intended ${m.intended} saved ${m.saved}`).join("; ")}. Hand-off blocked.`);
  }
  return { ok, line_id: row.id, action: before ? "updated" : "created", status, open_fields: r.issues.map((i) => i.field), verification: { ok, mismatches } };
}

export async function event(ctx: { ws: string; invoice: { id: string } }, orderId: string | null, kind: string, message: string) {
  await q("insert into events (ws, invoice_id, order_id, kind, message) values ($1,$2,$3,$4,$5)", [ctx.ws, ctx.invoice.id, orderId, kind, message]);
}

async function nextOrderNo(ws: string) {
  const r = await one<{ n: string }>("select count(*)::text as n from orders where ws = $1", [ws]);
  return `SO-${1001 + Number(r?.n ?? 0)}`;
}

export const TOOLS: Record<string, (ctx: ToolContext, input: Record<string, string>) => Promise<ToolResult>> = {
  async find_customer(_ctx, { query }) {
    const tokens = String(query ?? "").split(/[^A-Za-z0-9À-ɏ-]+/).filter((t) => t.length >= 2).slice(0, 6);
    if (!tokens.length) return { ok: true, customers: [] };
    const rows = await q<{ id: string; name: string; job_no: string }>(
      `select id, name, job_no from customers where ${tokens.map((_, i) => `(name ilike $${i + 1} or job_no ilike $${i + 1})`).join(" or ")} order by job_no limit 10`,
      tokens.map((t) => `%${t}%`),
    );
    return { ok: true, customers: rows };
  },

  async find_order(ctx, { supplier, invoice_number }) {
    const o = await one<{ id: string; order_no: string; status: string; customer_name: string; job_no: string; lines: number }>(
      `select o.id, o.order_no, o.status, c.name as customer_name, c.job_no, (select count(*)::int from order_lines l where l.order_id = o.id) as lines
       from orders o join customers c on c.id = o.customer_id where o.ws = $1 and o.supplier = $2 and o.invoice_no_norm = $3`,
      [ctx.ws, String(supplier).toUpperCase(), normInvoiceNo(invoice_number)],
    );
    return { ok: true, found: !!o, order: o };
  },

  async create_order(ctx, { customer_id, supplier, invoice_number }) {
    if (String(supplier).toUpperCase() !== ctx.invoice.supplier || normInvoiceNo(invoice_number) !== normInvoiceNo(ctx.invoice.invoice_no))
      return { ok: false, error: `this worker is processing ${ctx.invoice.supplier} ${ctx.invoice.invoice_no}; it cannot create orders for other invoices` };
    if (!/^[0-9a-f-]{36}$/i.test(customer_id)) return { ok: false, error: "unknown customer_id" };
    const c = await one<{ id: string; name: string; job_no: string }>("select id, name, job_no from customers where id = $1", [customer_id]);
    if (!c) return { ok: false, error: "unknown customer_id" };
    const sidemark = (ctx.invoice.sidemark ?? "").toUpperCase();
    const last = c.name.split(" ").slice(-1)[0].toUpperCase();
    if (!sidemark.includes(c.job_no.toUpperCase()))
      return { ok: false, error: `customer ${c.name} (${c.job_no}) does not match the invoice sidemark "${ctx.invoice.sidemark}". Pick the customer whose job number is on the sidemark.` };
    if (!sidemark.includes(last)) return { ok: false, error: `customer surname ${last} is not on the sidemark "${ctx.invoice.sidemark}"` };
    for (let attempt = 0; attempt < 3; attempt++) {
      const created = await one<{ id: string; order_no: string }>(
        `insert into orders (ws, order_no, customer_id, supplier, invoice_no_norm, status) values ($1,$2,$3,$4,$5,'draft')
         on conflict (ws, supplier, invoice_no_norm) do nothing returning id, order_no`,
        [ctx.ws, await nextOrderNo(ctx.ws), c.id, ctx.invoice.supplier, normInvoiceNo(ctx.invoice.invoice_no)],
      ).catch((e: { code?: string }) => (e.code === "23505" ? undefined : Promise.reject(e)));
      if (created === undefined) continue; // order_no race: retry
      if (created) {
        await event(ctx, created.id, "order_created", `Order ${created.order_no} created for ${c.name} (${c.job_no}).`);
        return { ok: true, already_existed: false, order: { ...created, customer: c.name } };
      }
      const existing = await one<{ id: string; order_no: string }>("select id, order_no from orders where ws = $1 and supplier = $2 and invoice_no_norm = $3", [ctx.ws, ctx.invoice.supplier, normInvoiceNo(ctx.invoice.invoice_no)]);
      return { ok: true, already_existed: true, order: existing, note: "An order already exists for this invoice; use it." };
    }
    return { ok: false, error: "could not allocate an order number" };
  },

  async add_or_update_line(ctx, { order_id, line_key }) {
    const o = await orderForInvoice(ctx, order_id);
    if ("error" in o) return { ok: false, error: o.error };
    if (o.order.status === "approved") return { ok: false, error: `order ${o.order.order_no} is already approved; changes need the office` };
    const il = (await invoiceLines(ctx.invoice.id)).find((l) => l.line_key === line_key);
    if (!il) return { ok: false, error: `line_key ${line_key} is not on this invoice` };
    const resolved = await resolveLine(ctx.ws, ctx.invoice.supplier, il);
    return writeAndVerify(ctx, o.order.id, resolved);
  },

  async set_status_for_review(ctx, { order_id }) {
    const o = await orderForInvoice(ctx, order_id);
    if ("error" in o) return { ok: false, error: o.error };
    const ils = await invoiceLines(ctx.invoice.id);
    const lines = await q<Record<string, unknown> & { line_key: string; status: string; verified_ok: boolean }>(`select line_key, status, verified_ok, ${LINE_COLUMNS} from order_lines where order_id = $1`, [o.order.id]);
    const problems: string[] = [];
    for (const il of ils) {
      const saved = lines.find((l) => l.line_key === il.line_key);
      if (!saved) {
        problems.push(`line ${il.line_no} is not on the order yet`);
        continue;
      }
      const r = await resolveLine(ctx.ws, ctx.invoice.supplier, il);
      if (r.issues.length) problems.push(`line ${il.line_no} still needs: ${r.issues.map((i) => i.field).join(", ")}`);
      else if (saved.status !== "complete") problems.push(`line ${il.line_no} was saved before its answers; update it first`);
      if (!saved.verified_ok) problems.push(`line ${il.line_no} failed read-back verification`);
      else if (compareLine(r.values, saved).length) problems.push(`line ${il.line_no} on the order differs from the validated values; update it first`);
    }
    const open = await one<{ n: number }>("select count(*)::int as n from questions where invoice_id = $1 and status in ('open','escalated')", [ctx.invoice.id]);
    if (open && open.n > 0) problems.push(`${open.n} question(s) still open`);
    if (problems.length) {
      await q("update orders set status = case when status = 'blocked' then 'blocked' else 'needs_info' end, updated_at = now() where id = $1", [o.order.id]);
      return { ok: false, error: "not ready for review", problems };
    }
    await q("update orders set status = 'in_review', review_note = null, updated_at = now() where id = $1", [o.order.id]);
    await q("update invoices set status = 'in_review', order_id = $2, updated_at = now() where id = $1", [ctx.invoice.id, o.order.id]);
    await event(ctx, o.order.id, "handed_off", `Order ${o.order.order_no} handed to office review.`);
    return { ok: true, status: "in_review", order_no: o.order.order_no };
  },
};

export async function runTool(ctx: ToolContext, name: string, input: unknown): Promise<ToolResult> {
  const t0 = Date.now();
  const fn = TOOLS[name];
  let out: ToolResult;
  try {
    out = fn ? await fn(ctx, (input ?? {}) as Record<string, string>) : { ok: false, error: `unknown tool ${name}` };
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  await q("insert into tool_calls (ws, invoice_id, stage, tool, input, output, ok, ms) values ($1,$2,$3,$4,$5,$6,$7,$8)", [
    ctx.ws, ctx.invoice.id, ctx.stage, name, JSON.stringify(input ?? {}), JSON.stringify(out), out.ok, Date.now() - t0,
  ]);
  return out;
}
