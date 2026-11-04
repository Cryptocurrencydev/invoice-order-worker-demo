// Evaluation: runs all 25 invoices through the real worker (real model, local Postgres) and scores
// the results against ground truth. A simulated salesperson answers questions from the ground truth.
//   npm run eval                 → worker eval → data/eval/results.json
//   npm run eval -- --baseline   → also run the "agent improvises" baseline → data/eval/baseline.json
import "./load-env.ts";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { one, pool, q } from "../src/lib/db.ts";
import { LIFTS, MOUNTS, PRODUCT_TYPES, SIDES, VALANCES, supplierByCode } from "../src/lib/catalog.ts";
import { anthropicClient, MODEL_ID, type ModelClient } from "../src/lib/worker/model.ts";
import { answerQuestion, createInvoice, processInvoice, supplierDoc } from "../src/lib/worker/pipeline.ts";
import { pdfToText } from "../src/lib/worker/pdf-text.ts";
import { validateLine } from "../src/lib/worker/validate.ts";
import { describeValue } from "../src/lib/worker/questions.ts";
import { LINE_FIELDS, type LineField, type LineValues } from "../src/lib/worker/types.ts";

const root = new URL("..", import.meta.url).pathname;
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgres://localhost/iow_eval";
const BASELINE = process.argv.includes("--baseline");
const ONLY_BASELINE = process.argv.includes("--only-baseline");
const CONCURRENCY = 4;

interface GT {
  file: string;
  invoice_number: string;
  supplier: string;
  customer_job: string;
  layout: string;
  scanned: boolean;
  duplicate_of: string | null;
  lines: { line_no: number; final: LineValues; printed: LineValues }[];
  expected_issues: { line_no: number; field: LineField; kind: string }[];
  answers: { line_no: number; field: LineField; answer: string }[];
}
const gts: (GT & { id: string })[] = readdirSync(root + "data/ground-truth").sort().map((f) => ({ id: f.replace(".json", ""), ...JSON.parse(readFileSync(root + "data/ground-truth/" + f, "utf8")) }));

// ---- token accounting ----
const usage: Record<string, { calls: number; input: number; output: number }> = {};
function counting(inner: ModelClient): ModelClient {
  return {
    name: inner.name,
    async create(params, purpose) {
      const r = await inner.create(params, purpose);
      const u = (usage[purpose] ??= { calls: 0, input: 0, output: 0 });
      u.calls++;
      u.input += (r.usage?.input_tokens ?? 0) + (r.usage?.cache_read_input_tokens ?? 0) + (r.usage?.cache_creation_input_tokens ?? 0);
      u.output += r.usage?.output_tokens ?? 0;
      return r;
    },
  };
}
const cost = () => Object.values(usage).reduce((a, u) => a + (u.input * 4 + u.output * 20) / 1e6, 0);

async function pmap<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

const same = (a: unknown, b: unknown) => (a == null || a === "" ? b == null || b === "" : b != null && (typeof a === "number" || typeof b === "number" ? Number(a) === Number(b) : String(a).toUpperCase() === String(b).toUpperCase()));
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 100);

// =====================================================================
async function runWorkerEval() {
  const model = counting(anthropicClient());
  const ws = `eval-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const started = Date.now();
  const perInvoice: Record<string, { invId: string; ms: number; status: string }> = {};
  const runOne = async (g: GT & { id: string }) => {
    const t0 = Date.now();
    const invId = await createInvoice(ws, g.file, new Uint8Array(readFileSync(root + "public/samples/" + g.file)));
    const r = await processInvoice(invId, { model });
    perInvoice[g.id] = { invId, ms: Date.now() - t0, status: r.status };
    console.log(`${g.id} → ${r.status}${"error" in r && r.error ? ` (${r.error})` : ""} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  };
  // originals first (in parallel), then the re-sent copy
  await pmap(gts.filter((g) => !g.duplicate_of), CONCURRENCY, runOne);
  for (const g of gts.filter((g) => g.duplicate_of)) await runOne(g);
  const firstPassMs = Date.now() - started;

  // ---- simulated salesperson ----
  const qStats: Record<string, { asked: number; planned: number; unplanned: string[] }> = {};
  for (const g of gts) {
    const { invId } = perInvoice[g.id];
    const st = (qStats[g.id] = { asked: 0, planned: 0, unplanned: [] as string[] });
    for (let i = 0; i < 10; i++) {
      const qn = await one<{ id: string; line_no: number; field: LineField; text: string }>("select id, line_no, field, text from questions where invoice_id = $1 and status = 'open' order by created_at limit 1", [invId]);
      if (!qn) break;
      st.asked++;
      const planned = g.answers.find((a) => a.line_no === qn.line_no && a.field === qn.field);
      let answer: string;
      if (planned) {
        st.planned++;
        answer = planned.answer;
      } else {
        const truth = g.lines.find((l) => l.line_no === qn.line_no)?.final;
        answer = truth ? describeValue(qn.field, (truth as unknown as Record<string, unknown>)[qn.field]).replace('"', "") : "unknown";
        st.unplanned.push(`line ${qn.line_no} ${qn.field}`);
      }
      const t0 = Date.now();
      await answerQuestion(qn.id, ws, answer, "Sim salesperson", { model });
      perInvoice[g.id].ms += Date.now() - t0;
    }
  }

  // ---- scoring ----
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: Record<string, any>[] = [];
  let extOk = 0, extTotal = 0, finOk = 0, finTotal = 0;
  let expectedIssues = 0, caughtIssues = 0, expectedInvalid = 0, caughtInvalid = 0, falseFlags = 0;
  let falseWrites = 0, invalidWrites = 0, writes = 0, readbacks = 0, readbackMismatches = 0;
  const fieldStats: Record<string, { ok: number; total: number }> = {};
  const errors: string[] = [];
  for (const g of gts) {
    const { invId } = perInvoice[g.id];
    const inv = (await one<{ status: string; text_method: string; order_id: string | null; duplicate_of: string | null; timings: Record<string, number> }>("select status, text_method, order_id, duplicate_of, timings from invoices where id = $1", [invId]))!;
    const supplier = supplierByCode(g.supplier)!;
    const row: Record<string, unknown> = { id: g.id, file: g.file, supplier: g.supplier, layout: g.layout, scanned: g.scanned, duplicate_of: g.duplicate_of, status: inv.status, text_method: inv.text_method, ms: perInvoice[g.id].ms, questions: qStats[g.id].asked, unplanned_questions: qStats[g.id].unplanned };
    if (g.duplicate_of) {
      rows.push({ ...row, duplicate_detected: inv.status === "duplicate" && !!inv.duplicate_of });
      continue;
    }
    // extraction accuracy (before any answers): normalised values vs what is printed on the invoice
    const ils = await q<{ line_no: number; normalized: LineValues; issues: { field: LineField; kind: string }[] }>("select line_no, normalized, issues from invoice_lines where invoice_id = $1", [invId]);
    let e = 0, et = 0;
    const misses: string[] = [];
    for (const l of g.lines) {
      const got = ils.find((x) => x.line_no === l.line_no)?.normalized;
      for (const f of LINE_FIELDS) {
        et++;
        const ok = !!got && same((l.printed as unknown as Record<string, unknown>)[f], (got as unknown as Record<string, unknown>)[f]);
        (fieldStats[f] ??= { ok: 0, total: 0 }).total++;
        if (ok) {
          e++;
          fieldStats[f].ok++;
        } else misses.push(`L${l.line_no} ${f}: expected ${JSON.stringify((l.printed as unknown as Record<string, unknown>)[f])} got ${JSON.stringify(got ? (got as unknown as Record<string, unknown>)[f] : "no line")}`);
      }
    }
    extOk += e;
    extTotal += et;
    // issues caught
    const raised = ils.flatMap((l) => l.issues.map((i) => ({ line_no: l.line_no, ...i })));
    for (const x of g.expected_issues) {
      expectedIssues++;
      const hit = raised.some((r) => r.line_no === x.line_no && r.field === x.field);
      if (hit) caughtIssues++;
      if (x.kind === "invalid") {
        expectedInvalid++;
        if (hit) caughtInvalid++;
      }
    }
    const extra = raised.filter((r) => !g.expected_issues.some((x) => x.line_no === r.line_no && x.field === r.field));
    falseFlags += extra.length;
    // final order vs truth
    const saved = inv.order_id ? await q<Record<string, unknown> & { line_no: number }>(`select line_no, ${LINE_FIELDS.join(", ")} from order_lines where order_id = $1`, [inv.order_id]) : [];
    let fo = 0, ft = 0;
    const finalMisses: string[] = [];
    for (const l of g.lines) {
      const s = saved.find((x) => x.line_no === l.line_no);
      for (const f of LINE_FIELDS) {
        ft++;
        if (s && same((l.final as unknown as Record<string, unknown>)[f], s[f])) fo++;
        else finalMisses.push(`L${l.line_no} ${f}: expected ${JSON.stringify((l.final as unknown as Record<string, unknown>)[f])} got ${JSON.stringify(s ? s[f] : "no line")}`);
      }
    }
    finOk += fo;
    finTotal += ft;
    // false writes: any value ever written (every verified write) that contradicts the truth, or any invalid combination
    const vs = await q<{ saved: Record<string, unknown>; ok: boolean; line_no: number }>("select v.saved, v.ok, ol.line_no from verifications v join order_lines ol on ol.id = v.order_line_id where v.invoice_id = $1", [invId]);
    const fw: string[] = [];
    for (const v of vs) {
      writes++;
      readbacks++;
      if (!v.ok) readbackMismatches++;
      const truth = g.lines.find((l) => l.line_no === v.line_no)?.final as unknown as Record<string, unknown> | undefined;
      for (const f of LINE_FIELDS) {
        const val = v.saved[f];
        if (val == null) continue; // empty = waiting for an answer, not a false write
        if (!truth || !same(truth[f], val)) fw.push(`L${v.line_no} ${f}=${JSON.stringify(val)} (truth ${JSON.stringify(truth?.[f])})`);
      }
      const issues = validateLine(supplier, v.saved as unknown as LineValues).filter((i) => i.kind !== "missing");
      if (issues.length) invalidWrites++;
    }
    falseWrites += fw.length;
    if (inv.status !== "in_review") errors.push(`${g.id}: ended ${inv.status}`);
    rows.push({ ...row, extraction: { ok: e, total: et, misses }, final: { ok: fo, total: ft, misses: finalMisses }, expected_issues: g.expected_issues.length, raised_issues: raised.map((r) => `L${r.line_no} ${r.kind} ${r.field}`), extra_flags: extra.map((r) => `L${r.line_no} ${r.kind} ${r.field}`), false_writes: fw, timings: inv.timings });
  }
  const orderCount = (await one<{ n: number }>("select count(*)::int as n from orders where ws = $1", [ws]))!.n;
  const handed = (await one<{ n: number }>("select count(*)::int as n from orders where ws = $1 and status = 'in_review'", [ws]))!.n;
  const dupRows = rows.filter((r) => r.duplicate_of);
  const unique = gts.filter((g) => !g.duplicate_of);
  const summary = {
    run_at: new Date().toISOString(),
    model: MODEL_ID,
    invoices: gts.length,
    unique_invoices: unique.length,
    lines: unique.reduce((a, g) => a + g.lines.length, 0),
    extraction_field_accuracy: pct(extOk, extTotal),
    extraction_fields: { ok: extOk, total: extTotal },
    final_order_field_accuracy: pct(finOk, finTotal),
    final_fields: { ok: finOk, total: finTotal },
    field_accuracy_by_field: Object.fromEntries(Object.entries(fieldStats).map(([k, v]) => [k, pct(v.ok, v.total)])),
    orders_needing_questions: Object.entries(qStats).filter(([, s]) => s.asked > 0).length,
    orders_needing_questions_expected: unique.filter((g) => g.answers.length).length,
    questions_asked: Object.values(qStats).reduce((a, s) => a + s.asked, 0),
    questions_expected: unique.reduce((a, g) => a + g.answers.length, 0),
    unplanned_questions: Object.values(qStats).reduce((a, s) => a + s.unplanned.length, 0),
    repeated_questions: (await one<{ n: number }>("select count(*)::int as n from (select line_key, field, text from questions where ws = $1 group by 1,2,3 having count(*) > 1) x", [ws]))!.n,
    issues_expected: expectedIssues,
    issues_caught: caughtIssues,
    invalid_options_expected: expectedInvalid,
    invalid_options_caught: caughtInvalid,
    false_flags: falseFlags,
    duplicates_sent: dupRows.length,
    duplicates_prevented: dupRows.filter((r) => r.duplicate_detected).length,
    orders_created: orderCount,
    orders_handed_to_review: handed,
    writes,
    readback_checks: readbacks,
    readback_mismatches: readbackMismatches,
    false_writes: falseWrites,
    invalid_writes: invalidWrites,
    scanned_invoices: gts.filter((g) => g.scanned).length,
    ocr_used: rows.filter((r) => r.text_method === "ocr").length,
    errors,
    timing: {
      first_pass_wall_s: Math.round(firstPassMs / 100) / 10,
      concurrency: CONCURRENCY,
      avg_invoice_s: Math.round(rows.reduce((a, r) => a + (r.ms as number), 0) / rows.length / 100) / 10,
      avg_extract_s: Math.round(rows.filter((r) => r.timings).reduce((a, r) => a + ((r.timings as Record<string, number>).extract_ms ?? 0), 0) / unique.length / 100) / 10,
      avg_act_s: Math.round(rows.filter((r) => r.timings).reduce((a, r) => a + ((r.timings as Record<string, number>).act_ms ?? 0), 0) / unique.length / 100) / 10,
    },
    model_usage: usage,
    est_cost_usd: Math.round(cost() * 100) / 100,
  };
  return { summary, invoices: rows };
}

// =====================================================================
// Baseline: "the agent improvises" — one prompt, the model fills the order however it sees fit.
const BASELINE_SYSTEM = `You are an AI worker for a window covering dealer. Read the supplier invoice and produce the customer order lines, ready to place. Use the supplier product reference. Fill in every field; if something is missing, unclear or not valid for the product, use your best judgment so the order can go through without bothering the salespeople. Sizes as decimal inches.`;
const BASELINE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["lines"],
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["line_no", ...LINE_FIELDS],
        properties: {
          line_no: { type: "integer" }, room: { type: "string" }, product_type: { type: "string", enum: [...PRODUCT_TYPES] }, sku: { type: "string" }, width: { type: "number" }, height: { type: "number" },
          mount: { type: "string", enum: [...MOUNTS] }, lift: { type: "string", enum: [...LIFTS, "none"] }, control_side: { type: "string", enum: [...SIDES, "none"] },
          fabric_code: { type: "string" }, colour_code: { type: "string" }, valance: { type: "string", enum: [...VALANCES, "none"] },
          motor_code: { type: "string", description: "catalog code, or none" }, remote_code: { type: "string", description: "catalog code, or none" },
        },
      },
    },
  },
};

async function runBaseline() {
  const model = counting(anthropicClient());
  const started = Date.now();
  const unique = gts.filter((g) => !g.duplicate_of);
  const rows = await pmap(unique, CONCURRENCY, async (g) => {
    const t0 = Date.now();
    const text = (await pdfToText(new Uint8Array(readFileSync(root + "public/samples/" + g.file)))).text;
    const res = await model.create(
      { max_tokens: 16000, system: BASELINE_SYSTEM, output_config: { effort: "medium", format: { type: "json_schema", schema: BASELINE_SCHEMA } }, messages: [{ role: "user", content: `<supplier_product_reference>\n${supplierDoc(g.supplier)}\n</supplier_product_reference>\n\n<invoice_text>\n${text}\n</invoice_text>` }] },
      "baseline",
    );
    const t = res.content.find((b) => b.type === "text") as { text: string } | undefined;
    const out = (t ? JSON.parse(t.text).lines : []) as Record<string, unknown>[];
    const clean = (v: unknown) => (v == null || ["none", "n/a", ""].includes(String(v).toLowerCase()) ? null : v);
    let ok = 0, total = 0, wrong = 0, invalid = 0;
    const misses: string[] = [];
    for (const l of g.lines) {
      const got = out.find((x) => x.line_no === l.line_no);
      const vals = Object.fromEntries(LINE_FIELDS.map((f) => [f, clean(got?.[f])])) as unknown as LineValues;
      for (const f of LINE_FIELDS) {
        total++;
        const truth = (l.final as unknown as Record<string, unknown>)[f];
        const v = (vals as unknown as Record<string, unknown>)[f];
        if (same(truth, v)) ok++;
        else {
          misses.push(`L${l.line_no} ${f}: expected ${JSON.stringify(truth)} got ${JSON.stringify(v)}`);
          if (v != null) wrong++; // the improvising agent writes whatever it decided
        }
      }
      if (got && validateLine(supplierByCode(g.supplier)!, vals).some((i) => i.kind !== "missing")) invalid++;
    }
    console.log(`baseline ${g.id}: ${ok}/${total} fields, ${wrong} wrong values written`);
    return { id: g.id, ok, total, false_writes: wrong, invalid_lines_written: invalid, defects: g.expected_issues.length, misses, ms: Date.now() - t0 };
  });
  const sum = (k: "ok" | "total" | "false_writes" | "invalid_lines_written") => rows.reduce((a, r) => a + r[k], 0);
  const withDefects = rows.filter((r) => r.defects > 0);
  return {
    summary: {
      run_at: new Date().toISOString(),
      model: MODEL_ID,
      approach: "single prompt, model fills every field with its best judgment, writes directly",
      final_order_field_accuracy: pct(sum("ok"), sum("total")),
      final_fields: { ok: sum("ok"), total: sum("total") },
      false_writes: sum("false_writes"),
      invalid_lines_written: sum("invalid_lines_written"),
      questions_asked: 0,
      invoices_with_defects: withDefects.length,
      defect_invoices_fully_correct: withDefects.filter((r) => r.ok === r.total).length,
      duplicate_protection: "none (no invoice fingerprint): a re-sent invoice creates a second order",
      wall_s: Math.round((Date.now() - started) / 100) / 10,
      model_usage: usage.baseline,
    },
    invoices: rows,
  };
}

mkdirSync(root + "data/eval", { recursive: true });
if (!ONLY_BASELINE) {
  const r = await runWorkerEval();
  writeFileSync(root + "data/eval/results.json", JSON.stringify(r, null, 2) + "\n");
  console.log(JSON.stringify(r.summary, null, 2));
}
if (BASELINE || ONLY_BASELINE) {
  for (const k of Object.keys(usage)) delete usage[k];
  const b = await runBaseline();
  writeFileSync(root + "data/eval/baseline.json", JSON.stringify(b, null, 2) + "\n");
  console.log(JSON.stringify(b.summary, null, 2));
}
void randomUUID;
await pool().end();
