// Tool-call tests: the model's output is mocked (scripted tool calls), the tools, guards,
// read-back verification and database are real (local Postgres iow_test).
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { one, pool, q } from "@/lib/db";
import { answerQuestion, createInvoice, processInvoice, type WorkerDeps } from "@/lib/worker/pipeline";
import { mockModel } from "@/lib/worker/mock-model";
import type { Message, ModelClient } from "@/lib/worker/model";

const pdf = (id: string) => new Uint8Array(readFileSync(`public/samples/${id}.pdf`));
const ws = () => `test-${randomUUID()}`;
const deps: WorkerDeps = { model: mockModel() };

async function run(w: string, id: string, d: WorkerDeps = deps) {
  const invId = await createInvoice(w, `${id}.pdf`, pdf(id));
  const r = await processInvoice(invId, d);
  return { invId, ...r };
}
const orders = (w: string) => q<{ id: string; status: string; order_no: string }>("select id, status, order_no from orders where ws = $1", [w]);
const openQuestion = (invId: string) => one<{ id: string; field: string; text: string; line_no: number }>("select id, field, text, line_no from questions where invoice_id = $1 and status = 'open'", [invId]);
const toolLog = (invId: string) => q<{ tool: string; ok: boolean; output: { error?: string } }>("select tool, ok, output from tool_calls where invoice_id = $1 order by id", [invId]);

/** A model whose act step returns scripted tool calls; extraction still uses the mock. */
function scripted(script: (msgs: unknown[], step: number, toolResults: Record<string, unknown>[]) => { name: string; input: Record<string, unknown> }[] | string): ModelClient {
  const base = mockModel();
  let step = 0;
  return {
    name: "scripted",
    async create(params, purpose) {
      if (purpose !== "act") return base.create(params, purpose);
      const last = params.messages[params.messages.length - 1];
      const results = Array.isArray(last.content) ? (last.content as { type: string; content?: string }[]).filter((b) => b.type === "tool_result").map((b) => JSON.parse(b.content ?? "{}")) : [];
      const out = script(params.messages, step++, results);
      if (typeof out === "string") return { content: [{ type: "text", text: out }], stop_reason: "end_turn" } as unknown as Message;
      return { content: out.map((c, i) => ({ type: "tool_use", id: `t${step}_${i}`, name: c.name, input: c.input })), stop_reason: "tool_use" } as unknown as Message;
    },
  };
}

afterAll(async () => {
  if (!process.env.KEEP) await q("delete from invoices where ws like 'test-%'");
  if (!process.env.KEEP) await q("delete from orders where ws like 'test-%'");
  await pool().end();
});

describe("worker happy paths (mocked model)", () => {
  it("clean invoice → order created, every line written and verified, handed to review", async () => {
    const w = ws();
    const r = await run(w, "INV-01");
    expect(r.status).toBe("in_review");
    const [o] = await orders(w);
    expect(o.status).toBe("in_review");
    const lines = await q<{ verified_ok: boolean; status: string; width: string }>("select verified_ok, status, width from order_lines where order_id = $1", [o.id]);
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => l.verified_ok && l.status === "complete")).toBe(true);
    const vs = await q<{ ok: boolean }>("select ok from verifications where invoice_id = $1", [r.invId]);
    expect(vs.length).toBe(4);
    expect(vs.every((v) => v.ok)).toBe(true);
    expect((await toolLog(r.invId)).map((t) => t.tool)).toEqual(["find_customer", "find_order", "create_order", "add_or_update_line", "add_or_update_line", "add_or_update_line", "add_or_update_line", "set_status_for_review"]);
  });

  it("invalid option → value kept off the order, one question, answer stored on the line, then hand-off", async () => {
    const w = ws();
    const r = await run(w, "INV-04"); // NF-CS-310 printed with continuous loop (not offered)
    expect(r.status).toBe("needs_info");
    const [o] = await orders(w);
    const l1 = await one<{ id: string; lift: string | null; status: string; provenance: Record<string, unknown> }>("select id, lift, status, provenance from order_lines where order_id = $1 and line_no = 1", [o.id]);
    expect(l1).toMatchObject({ lift: null, status: "needs_info" });
    const qn = (await openQuestion(r.invId))!;
    expect(qn).toMatchObject({ field: "lift", line_no: 1 });
    expect(qn.text).toContain("Continuous loop is not offered");
    expect(await q("select 1 from questions where invoice_id = $1 and status = 'open'", [r.invId])).toHaveLength(1); // one at a time
    const res = await answerQuestion(qn.id, w, "Make it cordless", "Maya (sales)", deps);
    expect(res).toMatchObject({ done: true });
    const a = await one<{ order_line_id: string; value: string }>("select order_line_id, value from answers where question_id = $1", [qn.id]);
    expect(a).toMatchObject({ order_line_id: l1!.id, value: "cordless" });
    const after = await one<{ lift: string; status: string; provenance: { lift: { source: string; by: string; invoice_value: string } } }>("select lift, status, provenance from order_lines where id = $1", [l1!.id]);
    expect(after).toMatchObject({ lift: "cordless", status: "complete" });
    expect(after!.provenance.lift).toMatchObject({ source: "salesperson", by: "Maya (sales)", invoice_value: "continuous_loop" });
    expect((await orders(w))[0].status).toBe("in_review");
  });

  it("exact re-sent invoice → duplicate, no new order, no writes", async () => {
    const w = ws();
    await run(w, "INV-09");
    const before = await q("select id from order_lines where ws = $1", [w]);
    const dup = await run(w, "INV-25");
    expect(dup.status).toBe("duplicate");
    expect(await orders(w)).toHaveLength(1);
    expect(await q("select id from order_lines where ws = $1", [w])).toHaveLength(before.length);
    expect(await toolLog(dup.invId)).toHaveLength(0);
  });

  it("same invoice uploaded twice in parallel → still one order", async () => {
    const w = ws();
    const [a, b] = await Promise.all([run(w, "INV-01"), run(w, "INV-01")]);
    expect([a.status, b.status].sort()).toEqual(["duplicate", "in_review"]);
    expect(await orders(w)).toHaveLength(1);
  });

  it("never asks the same question twice: unusable answers get a rephrased question, then escalate", async () => {
    const w = ws();
    const r = await run(w, "INV-02"); // missing tilt side
    const q1 = (await openQuestion(r.invId))!;
    await answerQuestion(q1.id, w, "not sure", "Maya (sales)", deps);
    const q2 = (await openQuestion(r.invId))!;
    expect(q2.field).toBe(q1.field);
    expect(q2.text).not.toBe(q1.text);
    expect(q2.text).toContain("couldn't match");
    const res = await answerQuestion(q2.id, w, "ask the client", "Maya (sales)", deps);
    expect(res).toMatchObject({ next: null, escalated: true });
    const texts = (await q<{ text: string }>("select text from questions where invoice_id = $1", [r.invId])).map((x) => x.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect((await orders(w))[0].status).toBe("needs_info");
  });
});

describe("guards against a misbehaving model (scripted tool calls)", () => {
  it("rejects an order for the wrong customer", async () => {
    const w = ws();
    const wrong = (await one<{ id: string }>("select id from customers where job_no = 'J-2210'"))!.id; // Arjun Patel, not on INV-05's sidemark (PATEL / J-2205)
    const model = scripted((_m, step) => (step === 0 ? [{ name: "create_order", input: { customer_id: wrong, supplier: "BWB", invoice_number: "BWB/8835" } }] : "done"));
    const r = await run(w, "INV-05", { model });
    const log = await toolLog(r.invId);
    expect(log[0]).toMatchObject({ tool: "create_order", ok: false });
    expect(log[0].output.error).toContain("does not match the invoice sidemark");
    expect(await orders(w)).toHaveLength(0);
    expect(r.status).toBe("error");
  });

  it("rejects orders and lines for a different invoice", async () => {
    const w = ws();
    await run(w, "INV-01");
    const other = (await orders(w))[0];
    const model = scripted((_m, step) =>
      step === 0
        ? [
            { name: "create_order", input: { customer_id: randomUUID(), supplier: "NFS", invoice_number: "NF-99999" } },
            { name: "add_or_update_line", input: { order_id: other.id, line_key: "NFS-NF24103-L1" } },
          ]
        : "done",
    );
    const r = await run(w, "INV-17", { model });
    const log = await toolLog(r.invId);
    expect(log.map((l) => l.ok)).toEqual([false, false]);
    expect(log.find((l) => l.tool === "create_order")!.output.error).toContain("cannot create orders for other invoices");
    expect(log.find((l) => l.tool === "add_or_update_line")!.output.error).toContain("belongs to a different invoice");
  });

  it("refuses hand-off while lines are missing or need info", async () => {
    const w = ws();
    let orderId = "";
    const model = scripted((_m, step, results) => {
      if (step === 0) return [{ name: "find_customer", input: { query: "HERRERA J-2202" } }];
      if (step === 1) return [{ name: "create_order", input: { customer_id: (results[0].customers as { id: string }[])[0].id, supplier: "BWB", invoice_number: "BWB/8814" } }];
      if (step === 2) {
        orderId = (results[0].order as { id: string }).id;
        return [{ name: "set_status_for_review", input: { order_id: orderId } }];
      }
      if (step === 3) return [{ name: "add_or_update_line", input: { order_id: orderId, line_key: "BWB-BWB8814-L2" } }, { name: "set_status_for_review", input: { order_id: orderId } }];
      return "stopping";
    });
    const r = await run(w, "INV-02", { model });
    const log = await toolLog(r.invId);
    const reviews = log.filter((l) => l.tool === "set_status_for_review");
    expect(reviews.every((x) => !x.ok)).toBe(true);
    expect(JSON.stringify(reviews[0].output)).toContain("not on the order yet");
    expect((await orders(w))[0].status).not.toBe("in_review");
    expect(r.status).toBe("error"); // the worker stopped before writing every line
  });

  it("create_order twice for the same invoice returns the existing order (no duplicate)", async () => {
    const w = ws();
    const model = scripted((_m, step, results) => {
      if (step === 0) return [{ name: "find_customer", input: { query: "OKAFOR" } }];
      const id = step === 1 ? (results[0].customers as { id: string; job_no: string }[]).find((c) => c.job_no === "J-2201")!.id : "";
      if (step === 1) return [{ name: "create_order", input: { customer_id: id, supplier: "NFS", invoice_number: "NF-24103" } }, { name: "create_order", input: { customer_id: id, supplier: "NFS", invoice_number: "nf 24103" } }];
      return "done";
    });
    const r = await run(w, "INV-01", { model });
    const creates = (await toolLog(r.invId)).filter((l) => l.tool === "create_order");
    expect(creates.every((c) => c.ok)).toBe(true);
    expect(await orders(w)).toHaveLength(1);
  });

  it("read-back mismatch (faulty write path) blocks the hand-off", async () => {
    const w = ws();
    const faults = { mutateRow: (row: Record<string, unknown>) => ({ ...row, width: row.width == null ? null : Math.round(Number(row.width)) }) };
    const r = await run(w, "INV-01", { model: mockModel(), faults: faults as never });
    expect(r.status).toBe("error");
    const [o] = await orders(w);
    expect(o.status).toBe("blocked");
    const bad = await q<{ mismatches: { field: string }[] }>("select mismatches from verifications where invoice_id = $1 and not ok", [r.invId]);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0].mismatches[0].field).toBe("width");
    const log = await toolLog(r.invId);
    expect(log.find((l) => l.tool === "set_status_for_review")).toBeUndefined(); // mock stops; and a direct call would be refused:
  });

  it("unknown tools and malformed ids are errors, not writes", async () => {
    const w = ws();
    const model = scripted((_m, step) => (step === 0 ? [{ name: "update_database", input: { sql: "delete from orders" } }, { name: "add_or_update_line", input: { order_id: "1; drop table orders", line_key: "x" } }] : "done"));
    const r = await run(w, "INV-01", { model });
    const log = await toolLog(r.invId);
    expect(log.map((l) => [l.tool, l.ok]).sort()).toEqual([["add_or_update_line", false], ["update_database", false]]); // parallel calls: order not fixed
    expect(await orders(w)).toHaveLength(0);
  });
});
