import "server-only";
import { one, q } from "./db";
import { findProduct, supplierByCode } from "./catalog";
import { resolveInvoice } from "./worker/resolve";
import { optionsFor } from "./worker/questions";
import { LINE_FIELDS, type Issue, type LineValues } from "./worker/types";

export interface InvoiceState {
  invoice: {
    id: string;
    file_name: string;
    status: string;
    stage: string | null;
    supplier: string | null;
    supplier_name: string | null;
    invoice_no: string | null;
    sidemark: string | null;
    text_method: string | null;
    ocr_confidence: number | null;
    error: string | null;
    duplicate_of: { id: string; file_name: string } | null;
    timings: Record<string, number>;
    created_at: string;
  };
  lines: {
    line_no: number;
    line_key: string;
    product_name: string | null;
    extracted: Record<string, unknown>;
    values: LineValues;
    invoice_issues: Issue[];
    open_issues: Issue[];
  }[];
  questions: { id: string; line_no: number; field: string; text: string; status: string; created_at: string; options: { value: string; label: string }[]; answer: { text: string; by: string; value: unknown; interpreted_by: string } | null }[];
  order: null | {
    id: string;
    order_no: string;
    status: string;
    customer: string;
    job_no: string;
    review_note: string | null;
    reviewed_by: string | null;
    lines: (LineValues & { line_no: number; status: string; verified_ok: boolean; product_name: string | null; provenance: Record<string, { source: string; by?: string; answer?: string; invoice_value?: string | null }> })[];
  };
  events: { kind: string; message: string; created_at: string }[];
  tool_calls: { tool: string; stage: string; ok: boolean; input: unknown; output: unknown; ms: number; created_at: string }[];
}

export async function getInvoiceState(ws: string, id: string): Promise<InvoiceState | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const inv = await one<Record<string, unknown> & { id: string; supplier: string | null; order_id: string | null; duplicate_of: string | null; ws: string; invoice_no_norm: string | null }>(
    "select id, ws, file_name, status, stage, supplier, invoice_no, invoice_no_norm, sidemark, text_method, ocr_confidence, error, duplicate_of, order_id, timings, created_at from invoices where id = $1 and ws = $2",
    [id, ws],
  );
  if (!inv) return null;
  const supplier = supplierByCode(inv.supplier);
  const dup = inv.duplicate_of ? await one<{ id: string; file_name: string }>("select id, file_name from invoices where id = $1", [inv.duplicate_of]) : null;
  const ils = await q<{ line_no: number; line_key: string; extracted: Record<string, unknown>; pre_issues: Issue[]; issues: Issue[]; normalized: LineValues }>(
    "select line_no, line_key, extracted, pre_issues, issues, normalized from invoice_lines where invoice_id = $1 order by line_no",
    [id],
  );
  const resolved = supplier && ils.length && !inv.duplicate_of ? await resolveInvoice(ws, supplier.code, id) : [];
  const questions = await q<{ id: string; line_no: number; field: string; text: string; status: string; created_at: string; a_text: string | null; a_by: string | null; a_value: unknown; a_interp: string | null }>(
    `select qn.id, qn.line_no, qn.field, qn.text, qn.status, qn.created_at, a.answer_text as a_text, a.answered_by as a_by, a.value as a_value, a.interpreted_by as a_interp
     from questions qn left join answers a on a.question_id = qn.id where qn.invoice_id = $1 order by qn.created_at`,
    [id],
  );
  let orderId = inv.order_id;
  if (!orderId && inv.supplier && inv.invoice_no_norm) orderId = (await one<{ id: string }>("select id from orders where ws = $1 and supplier = $2 and invoice_no_norm = $3", [ws, inv.supplier, inv.invoice_no_norm]))?.id ?? null;
  const order = orderId ? await getOrder(ws, orderId) : null;
  const events = await q<{ kind: string; message: string; created_at: string }>("select kind, message, created_at from events where invoice_id = $1 order by id", [id]);
  const tool_calls = await q<InvoiceState["tool_calls"][number]>("select tool, stage, ok, input, output, ms, created_at from tool_calls where invoice_id = $1 order by id", [id]);
  return {
    invoice: {
      id: inv.id,
      file_name: inv.file_name as string,
      status: inv.status as string,
      stage: inv.stage as string | null,
      supplier: inv.supplier,
      supplier_name: supplier?.name ?? null,
      invoice_no: inv.invoice_no as string | null,
      sidemark: inv.sidemark as string | null,
      text_method: inv.text_method as string | null,
      ocr_confidence: inv.ocr_confidence as number | null,
      error: inv.error as string | null,
      duplicate_of: dup,
      timings: inv.timings as Record<string, number>,
      created_at: String(inv.created_at),
    },
    lines: ils.map((l) => {
      const r = resolved.find((x) => x.line_key === l.line_key);
      return {
        line_no: l.line_no,
        line_key: l.line_key,
        product_name: findProduct(supplier!, l.normalized.sku)?.name ?? null,
        extracted: l.extracted,
        values: l.normalized,
        invoice_issues: l.issues,
        open_issues: r?.issues ?? [],
      };
    }),
    questions: questions.map((x) => ({
      id: x.id, line_no: x.line_no, field: x.field, text: x.text, status: x.status, created_at: String(x.created_at),
      options: x.status === "open" && supplier ? optionsFor(supplier, resolved.find((r) => r.line_no === x.line_no)?.values ?? ({} as LineValues), x.field as never) : [],
      answer: x.a_text ? { text: x.a_text, by: x.a_by!, value: x.a_value, interpreted_by: x.a_interp! } : null })),
    order,
    events: events.map((e) => ({ ...e, created_at: String(e.created_at) })),
    tool_calls: tool_calls.map((t) => ({ ...t, created_at: String(t.created_at) })),
  };
}

export async function getOrder(ws: string, orderId: string) {
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return null;
  const o = await one<{ id: string; order_no: string; status: string; customer: string; job_no: string; review_note: string | null; reviewed_by: string | null; supplier: string; created_at: string }>(
    "select o.id, o.order_no, o.status, c.name as customer, c.job_no, o.review_note, o.reviewed_by, o.supplier, o.created_at from orders o join customers c on c.id = o.customer_id where o.id = $1 and o.ws = $2",
    [orderId, ws],
  );
  if (!o) return null;
  const lines = await q<Record<string, unknown>>(`select line_no, status, verified_ok, product_name, provenance, ${LINE_FIELDS.join(", ")} from order_lines where order_id = $1 order by line_no`, [orderId]);
  return {
    ...o,
    lines: lines.map((l) => ({ ...l, width: l.width == null ? null : Number(l.width), height: l.height == null ? null : Number(l.height) })) as NonNullable<InvoiceState["order"]>["lines"],
  };
}

export async function listInvoices(ws: string) {
  return q<{ id: string; file_name: string; status: string; stage: string | null; supplier: string | null; invoice_no: string | null; created_at: string; order_no: string | null; open_q: number }>(
    `select i.id, i.file_name, i.status, i.stage, i.supplier, i.invoice_no, i.created_at, o.order_no,
       (select count(*)::int from questions qn where qn.invoice_id = i.id and qn.status = 'open') as open_q
     from invoices i left join orders o on o.id = i.order_id where i.ws = $1 order by i.created_at desc limit 50`,
    [ws],
  );
}

export async function reviewQueue(ws: string) {
  return q<{ id: string; order_no: string; status: string; customer: string; job_no: string; supplier: string; lines: number; answered: number; updated_at: string; reviewed_by: string | null }>(
    `select o.id, o.order_no, o.status, c.name as customer, c.job_no, o.supplier, o.updated_at, o.reviewed_by,
       (select count(*)::int from order_lines l where l.order_id = o.id) as lines,
       (select count(*)::int from answers a join order_lines l on l.id = a.order_line_id where l.order_id = o.id and a.value is not null) as answered
     from orders o join customers c on c.id = o.customer_id where o.ws = $1 and o.status in ('in_review','approved','sent_back') order by (o.status = 'in_review') desc, o.updated_at desc`,
    [ws],
  );
}
