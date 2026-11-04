// The invoice-to-order worker: extract → validate → fingerprint → act (tools) → ask → hand off.
import { readFileSync } from "node:fs";
import path from "node:path";
import { one, q } from "../db";
import { detectSupplier, supplierByCode, SUPPLIERS, type Supplier } from "../catalog";
import { extractInvoice, interpretAnswer, visionOcr, type Message, type ModelClient } from "./model";
import { pdfToText } from "./pdf-text";
import { invoiceFingerprint, lineKey, linesHash, normInvoiceNo } from "./fingerprint";
import { normalizeLine } from "./validate";
import { invoiceLines, resolveInvoice, resolveLine } from "./resolve";
import { matchAnswerDeterministic, optionsFor, questionText } from "./questions";
import { event, runTool, TOOL_DEFS, type ToolContext } from "./tools";
import { ASKABLE_FIELDS, type LineField } from "./types";
import type Anthropic from "@anthropic-ai/sdk";

export interface WorkerDeps {
  model: ModelClient;
  faults?: ToolContext["faults"];
}

interface InvoiceRow {
  id: string;
  ws: string;
  file_name: string;
  status: string;
  supplier: string | null;
  invoice_no: string | null;
  sidemark: string | null;
  order_id: string | null;
  timings: Record<string, number>;
}

let docCache: Record<string, string> | null = null;
export function supplierDoc(code: string) {
  docCache ??= Object.fromEntries(SUPPLIERS.map((s) => [s.code, readFileSync(path.join(process.cwd(), "data/suppliers", `${s.code}.md`), "utf8")]));
  return docCache[code];
}

async function setStage(id: string, stage: string, extra: Record<string, unknown> = {}) {
  const keys = Object.keys(extra);
  await q(`update invoices set stage = $2, updated_at = now()${keys.map((k, i) => `, ${k} = $${i + 3}`).join("")} where id = $1`, [id, stage, ...keys.map((k) => extra[k])]);
}

async function timed<T>(timings: Record<string, number>, key: string, fn: () => Promise<T>) {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    timings[key] = (timings[key] ?? 0) + (Date.now() - t0);
  }
}

export async function createInvoice(ws: string, fileName: string, pdf: Uint8Array) {
  const r = await one<{ id: string }>("insert into invoices (ws, file_name, pdf, status, stage) values ($1,$2,$3,'processing','uploaded') returning id", [ws, fileName, Buffer.from(pdf)]);
  return r!.id;
}

/** Full first pass for an uploaded invoice. Never throws: failures land on the invoice as status=error. */
export async function processInvoice(invoiceId: string, deps: WorkerDeps) {
  const inv = await one<InvoiceRow & { pdf: Buffer }>("select * from invoices where id = $1", [invoiceId]);
  if (!inv) throw new Error("invoice not found");
  const ctxBase = { ws: inv.ws, invoice: { id: inv.id } };
  const timings: Record<string, number> = {};
  try {
    // 1. PDF → text (OCR fallback for scans)
    await setStage(inv.id, "reading");
    const pdfText = await timed(timings, "read_ms", () => pdfToText(new Uint8Array(inv.pdf), visionOcr(deps.model)));
    if (pdfText.text.replace(/\s/g, "").length < 40) throw new Error("no readable text in the PDF (even after OCR)");
    await setStage(inv.id, "extracting", { raw_text: pdfText.text, text_method: pdfText.method, ocr_confidence: pdfText.ocrConfidence ?? null });
    await event(ctxBase, null, "read", pdfText.method === "ocr" ? `Scanned PDF: text recovered with OCR (confidence ${pdfText.ocrConfidence}%).` : pdfText.method === "vision-ocr" ? "Scanned PDF: OCR engine unavailable, page transcribed verbatim by the vision model (then extracted and validated as usual)." : "Read the PDF text layer.");

    // 2. supplier (deterministic) → model extraction with that supplier's product reference
    const supplier = detectSupplier(pdfText.text);
    if (!supplier) throw new Error("could not identify the supplier from the invoice header");
    const extraction = await timed(timings, "extract_ms", () => extractInvoice(deps.model, pdfText.text, supplierDoc(supplier.code)));
    if (!extraction.invoice_number) throw new Error("no invoice number found");
    if (!extraction.lines.length) throw new Error("no window lines found");
    await event(ctxBase, null, "extracted", `Extracted ${extraction.lines.length} line(s) from ${supplier.name} invoice ${extraction.invoice_number}.`);

    // 3. deterministic normalisation + validation per line
    const normalized = extraction.lines.map((l) => ({ ext: l, ...normalizeLine(supplier, l, pdfText.text) }));
    const fp = invoiceFingerprint(supplier.code, extraction.invoice_number, normalized.map((n) => ({ line_no: n.ext.line_no, values: n.values })));
    const lh = linesHash(normalized.map((n) => ({ line_no: n.ext.line_no, values: n.values })));

    // 4. idempotency: an identical re-send changes nothing
    const dup = await one<{ id: string; order_id: string | null; file_name: string }>(
      "select id, order_id, file_name from invoices where ws = $1 and fingerprint = $2 and duplicate_of is null and id <> $3",
      [inv.ws, fp, inv.id],
    );
    const base = {
      supplier: supplier.code,
      invoice_no: extraction.invoice_number,
      invoice_no_norm: normInvoiceNo(extraction.invoice_number),
      sidemark: extraction.sidemark,
      extraction: JSON.stringify(extraction),
      lines_hash: lh,
    };
    if (dup) {
      await q("update invoices set status = 'duplicate', stage = 'done', duplicate_of = $2, order_id = $3, fingerprint = $4, timings = $5, updated_at = now() where id = $1", [inv.id, dup.id, dup.order_id, fp, JSON.stringify(timings)]);
      await setStage(inv.id, "done", base);
      await event(ctxBase, dup.order_id, "duplicate", `Identical to ${dup.file_name} (same supplier, invoice number and lines). No order changes made.`);
      return { status: "duplicate" as const };
    }
    try {
      await setStage(inv.id, "validating", { ...base, fingerprint: fp });
    } catch (e) {
      // concurrent identical upload won the unique index → treat as duplicate
      if ((e as { code?: string }).code === "23505") {
        await setStage(inv.id, "done", base);
        await q("update invoices set status = 'duplicate' where id = $1", [inv.id]);
        return { status: "duplicate" as const };
      }
      throw e;
    }
    for (const n of normalized) {
      await q(
        `insert into invoice_lines (invoice_id, line_no, line_key, extracted, normalized, pre_issues) values ($1,$2,$3,$4,$5,$6)
         on conflict (invoice_id, line_no) do update set extracted = excluded.extracted, normalized = excluded.normalized, pre_issues = excluded.pre_issues`,
        [inv.id, n.ext.line_no, lineKey(supplier.code, extraction.invoice_number, n.ext.line_no), JSON.stringify(n.ext), JSON.stringify(n.values), JSON.stringify(n.issues)],
      );
    }
    const resolved = await resolveInvoice(inv.ws, supplier.code, inv.id);
    for (const r of resolved) await q("update invoice_lines set issues = $3 where invoice_id = $1 and line_key = $2", [inv.id, r.line_key, JSON.stringify(r.issues)]);
    const flagged = resolved.reduce((a, r) => a + r.issues.length, 0);
    await event(ctxBase, null, "validated", flagged ? `Validation flagged ${flagged} issue(s) across ${resolved.filter((r) => r.issues.length).length} line(s).` : "All lines passed validation against the product rules.");

    // 5. act through tools
    await setStage(inv.id, "writing");
    await timed(timings, "act_ms", () => runActLoop(inv.id, "sync", deps));
    await afterAct(inv.id, deps, timings);
    return { status: (await one<{ status: string }>("select status from invoices where id = $1", [inv.id]))!.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await q("update invoices set status = 'error', stage = 'error', error = $2, timings = $3, updated_at = now() where id = $1", [inv.id, msg, JSON.stringify(timings)]);
    await event(ctxBase, null, "error", msg);
    return { status: "error" as const, error: msg };
  }
}

/** After a tool loop: verify the model actually did the job, then queue the next question or confirm hand-off. */
async function afterAct(invoiceId: string, deps: WorkerDeps, timings: Record<string, number>) {
  const inv = (await one<InvoiceRow>("select id, ws, status, supplier, invoice_no, sidemark, order_id, timings from invoices where id = $1", [invoiceId]))!;
  const order = await one<{ id: string; status: string }>("select id, status from orders where ws = $1 and supplier = $2 and invoice_no_norm = $3", [inv.ws, inv.supplier, normInvoiceNo(inv.invoice_no)]);
  const allTimings = JSON.stringify({ ...inv.timings, ...Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, (inv.timings[k] ?? 0) + v])) });
  if (!order) {
    await q("update invoices set status = 'error', stage = 'error', error = $2, timings = $3, updated_at = now() where id = $1", [invoiceId, "the worker did not create or find an order (customer not matched?)", allTimings]);
    return;
  }
  const lines = await invoiceLines(invoiceId);
  const onOrder = await q<{ line_key: string }>("select line_key from order_lines where order_id = $1", [order.id]);
  const missing = lines.filter((l) => !onOrder.some((o) => o.line_key === l.line_key));
  if (missing.length) {
    await q("update invoices set status = 'error', stage = 'error', order_id = $2, error = $3, timings = $4, updated_at = now() where id = $1", [invoiceId, order.id, `the worker stopped before writing line(s) ${missing.map((m) => m.line_no).join(", ")}`, allTimings]);
    return;
  }
  if (order.status === "blocked") {
    await q("update invoices set status = 'error', stage = 'blocked', order_id = $2, error = 'read-back verification failed; hand-off blocked', timings = $3, updated_at = now() where id = $1", [invoiceId, order.id, allTimings]);
    return;
  }
  if (order.status === "in_review") {
    await q("update invoices set status = 'in_review', stage = 'done', order_id = $2, timings = $3, updated_at = now() where id = $1", [invoiceId, order.id, allTimings]);
    return;
  }
  await q("update orders set status = 'needs_info', updated_at = now() where id = $1 and status = 'draft'", [order.id]);
  await q("update invoices set status = 'needs_info', stage = 'asking', order_id = $2, timings = $3, updated_at = now() where id = $1", [invoiceId, order.id, allTimings]);
  const next = await ensureNextQuestion(invoiceId);
  if (!next) {
    // nothing left to ask (e.g. answers already on file from an earlier copy of this invoice) → sync again
    await runActLoop(invoiceId, "finalize", deps);
    await afterActFinal(invoiceId, order.id);
  }
}

async function afterActFinal(invoiceId: string, orderId: string) {
  const order = await one<{ status: string }>("select status from orders where id = $1", [orderId]);
  if (order?.status === "in_review") await q("update invoices set status = 'in_review', stage = 'done', order_id = $2 where id = $1", [invoiceId, orderId]);
  else if (order?.status === "blocked") await q("update invoices set status = 'error', stage = 'blocked', error = 'read-back verification failed; hand-off blocked' where id = $1", [invoiceId]);
  else await q("update invoices set status = 'error', stage = 'error', error = 'all questions answered but the worker could not hand the order off' where id = $1 and status <> 'in_review'", [invoiceId]);
}

export const ACT_SYSTEM = `You are the order-entry worker for Harbor & Pine Window Studio. You turn one processed supplier invoice into the customer's order by calling the app's functions. You never type field values: each line's values come from the app's validated invoice data, keyed by line_key.

Procedure:
1. find_customer with the sidemark (surname and job number). The right customer is the one whose job number is on the sidemark. If no customer matches exactly, stop and say so.
2. find_order for the supplier code and invoice number. If an order exists, use it: this invoice was already processed (re-sent or revised). Never create a second order for the same invoice.
3. If no order exists, create_order.
4. add_or_update_line for every line_key in the summary. These calls are independent; make them in parallel.
5. If every line came back with status "complete" and verification ok, call set_status_for_review. If any line still needs information, do not call it.
6. Finish with one short sentence saying what you did. Only report what the tools confirmed. If a tool returns an error, read it, correct your call if you can, otherwise stop and explain.`;

export async function runActLoop(invoiceId: string, stage: "sync" | "finalize", deps: WorkerDeps) {
  const inv = (await one<InvoiceRow>("select id, ws, supplier, invoice_no, sidemark, order_id, timings, status, file_name from invoices where id = $1", [invoiceId]))!;
  const supplier = supplierByCode(inv.supplier) as Supplier;
  const ctx: ToolContext = { ws: inv.ws, stage, invoice: { id: inv.id, supplier: supplier.code, invoice_no: inv.invoice_no!, sidemark: inv.sidemark }, faults: deps.faults };
  const resolved = await resolveInvoice(inv.ws, supplier.code, invoiceId);
  const summary = {
    stage: stage === "sync" ? "New invoice processed. Create or update the order." : "The salesperson answered the open questions. Update the order lines and hand off if complete.",
    invoice: { supplier_code: supplier.code, supplier_name: supplier.name, invoice_number: inv.invoice_no, sidemark: inv.sidemark },
    lines: resolved.map((r) => ({ line_key: r.line_key, line_no: r.line_no, room: r.values.room, sku: r.values.sku, status: r.issues.length ? "needs_info" : "complete", open_fields: r.issues.map((i) => i.field) })),
  };
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: JSON.stringify(summary, null, 2) }];
  for (let turn = 0; turn < 12; turn++) {
    const res: Message = await deps.model.create({ max_tokens: 8000, system: ACT_SYSTEM, tools: TOOL_DEFS, tool_choice: { type: "auto" }, output_config: { effort: "low" }, messages }, "act");
    messages.push({ role: "assistant", content: res.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
    if (res.stop_reason === "refusal") throw new Error("model declined the order-entry step");
    const uses = res.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) {
      const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ").trim();
      if (text) await event(ctx, null, "worker_note", text.slice(0, 500));
      return;
    }
    // independent calls run in parallel; results go back in one message
    const results = await Promise.all(uses.map(async (u) => ({ u, out: await runTool(ctx, u.name, u.input) })));
    messages.push({
      role: "user",
      content: results.map(({ u, out }) => ({ type: "tool_result" as const, tool_use_id: u.id, content: JSON.stringify(out), is_error: !out.ok })),
    });
  }
  await event(ctx, null, "worker_note", "Stopped after 12 tool turns.");
}

// ---------- questions ----------
const FIELD_ORDER: LineField[] = ["sku", "room", "width", "height", "mount", "lift", "control_side", "fabric_code", "colour_code", "valance", "motor_code", "remote_code"];

/** Returns the one open question for this invoice, creating it if needed. Null when nothing is left to ask. */
export async function ensureNextQuestion(invoiceId: string) {
  const open = await one<{ id: string }>("select id from questions where invoice_id = $1 and status = 'open' order by created_at limit 1", [invoiceId]);
  if (open) return open.id;
  const inv = (await one<InvoiceRow>("select id, ws, supplier from invoices where id = $1", [invoiceId]))!;
  const supplier = supplierByCode(inv.supplier)!;
  const resolved = await resolveInvoice(inv.ws, supplier.code, invoiceId);
  for (const r of resolved) {
    const issues = [...r.issues].filter((i) => ASKABLE_FIELDS.includes(i.field)).sort((a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field));
    for (const issue of issues) {
      const prior = await q<{ text: string; status: string }>("select text, status from questions where ws = $1 and line_key = $2 and field = $3", [inv.ws, r.line_key, issue.field]);
      if (prior.some((p) => p.status === "escalated")) continue;
      let text = questionText(supplier, r.line_no, r.values, issue, 1);
      let attempt = 1;
      if (prior.some((p) => p.text === text)) {
        text = questionText(supplier, r.line_no, r.values, issue, 2);
        attempt = 2;
      }
      const ol = await one<{ id: string }>("select id from order_lines where ws = $1 and line_key = $2", [inv.ws, r.line_key]);
      if (prior.some((p) => p.text === text)) {
        // asked both ways already: never repeat — escalate to the office instead
        await q(
          "insert into questions (ws, invoice_id, order_line_id, line_key, line_no, field, kind, attempt, text, status) values ($1,$2,$3,$4,$5,$6,$7,3,$8,'escalated') on conflict do nothing",
          [inv.ws, invoiceId, ol?.id ?? null, r.line_key, r.line_no, issue.field, issue.kind, `Escalated to office: ${issue.message}`],
        );
        await event({ ws: inv.ws, invoice: { id: invoiceId } }, null, "escalated", `Line ${r.line_no} ${issue.field}: no usable answer after two questions; escalated to the office.`);
        continue;
      }
      const row = await one<{ id: string }>(
        `insert into questions (ws, invoice_id, order_line_id, line_key, line_no, field, kind, attempt, text) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (ws, line_key, field, text) do nothing returning id`,
        [inv.ws, invoiceId, ol?.id ?? null, r.line_key, r.line_no, issue.field, issue.kind, attempt, text],
      );
      if (row) return row.id;
    }
  }
  return null;
}

export async function answerQuestion(questionId: string, ws: string, answerText: string, answeredBy: string, deps: WorkerDeps) {
  const qn = await one<{ id: string; invoice_id: string; line_key: string; field: LineField; text: string; status: string; order_line_id: string | null }>(
    "select * from questions where id = $1 and ws = $2",
    [questionId, ws],
  );
  if (!qn) throw new Error("question not found");
  if (qn.status !== "open") throw new Error("question already answered");
  const inv = (await one<InvoiceRow>("select id, ws, supplier, order_id, timings from invoices where id = $1", [qn.invoice_id]))!;
  const supplier = supplierByCode(inv.supplier)!;
  const il = (await invoiceLines(inv.id)).find((l) => l.line_key === qn.line_key)!;
  const current = await resolveLine(ws, supplier.code, il);
  const answer = answerText.trim().slice(0, 300);
  let value: string | number | null = matchAnswerDeterministic(supplier, current.values, qn.field, answer);
  let by = "rules";
  const options = optionsFor(supplier, current.values, qn.field);
  if (value == null && options.length) {
    value = await interpretAnswer(deps.model, qn.text, options, answer);
    by = "model";
  }
  await q(
    "insert into answers (ws, question_id, order_line_id, line_key, field, answer_text, value, interpreted_by, answered_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [ws, qn.id, qn.order_line_id, qn.line_key, qn.field, answer, value == null ? null : JSON.stringify(value), by, answeredBy],
  );
  await q("update questions set status = 'answered' where id = $1", [qn.id]);
  await event({ ws, invoice: { id: inv.id } }, inv.order_id, "answer", value == null ? `${answeredBy} answered "${answer}" — not a usable ${qn.field}; will ask differently.` : `${answeredBy} answered line ${il.line_no} ${qn.field}: ${value}.`);

  const next = await ensureNextQuestion(inv.id);
  if (next) return { next };
  const escalated = await one<{ n: number }>("select count(*)::int as n from questions where invoice_id = $1 and status = 'escalated'", [inv.id]);
  if (escalated && escalated.n > 0) {
    await q("update invoices set stage = 'escalated' where id = $1", [inv.id]);
    return { next: null, escalated: true };
  }
  // everything answered → let the worker update the order and hand it off
  await setStage(inv.id, "writing");
  const timings: Record<string, number> = {};
  await timed(timings, "finalize_ms", () => runActLoop(inv.id, "finalize", deps));
  const order = await one<{ id: string }>("select id from orders where ws = $1 and supplier = $2 and invoice_no_norm = (select invoice_no_norm from invoices where id = $3)", [ws, supplier.code, inv.id]);
  if (order) await afterActFinal(inv.id, order.id);
  await q("update invoices set timings = timings || $2::jsonb where id = $1", [inv.id, JSON.stringify(timings)]);
  return { next: null, done: true };
}

// ---------- office review ----------
export async function reviewOrder(ws: string, orderId: string, action: "approve" | "send_back", by: string, note: string | null) {
  const o = await one<{ id: string; status: string; order_no: string }>("select id, status, order_no from orders where id = $1 and ws = $2", [orderId, ws]);
  if (!o) throw new Error("order not found");
  if (o.status !== "in_review") throw new Error(`order is ${o.status}, not in review`);
  const status = action === "approve" ? "approved" : "sent_back";
  await q("update orders set status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now() where id = $1", [o.id, status, note, by]);
  await q("update invoices set status = $2, updated_at = now() where order_id = $1 and status = 'in_review'", [o.id, status]);
  const inv = await one<{ id: string }>("select id from invoices where order_id = $1 and duplicate_of is null order by created_at desc limit 1", [o.id]);
  if (inv) await event({ ws, invoice: { id: inv.id } }, o.id, action, action === "approve" ? `${by} approved ${o.order_no}.` : `${by} sent ${o.order_no} back: ${note ?? ""}`);
  return { status };
}
