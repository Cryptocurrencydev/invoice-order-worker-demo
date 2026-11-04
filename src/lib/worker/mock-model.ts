// Deterministic stand-in for the model, used by the e2e suite (WORKER_MODEL=mock) and unit tests.
// Extraction replays the ground truth's printed values; the act step follows the same procedure the
// real model is prompted with, through the same tools and guards.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { formatInches } from "../fractions";
import { textContains } from "./validate";
import type { Message, ModelClient } from "./model";
import type { ExtractedLine, Extraction, LineValues } from "./types";

interface GroundTruth {
  invoice_number: string;
  sidemark: string;
  lines: { line_no: number; printed: LineValues; final: LineValues }[];
  expected_issues: { line_no: number; field: string; kind: string }[];
}

let gts: GroundTruth[] | null = null;
function groundTruths() {
  const dir = path.join(process.cwd(), "data/ground-truth");
  gts ??= readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
  return gts;
}

const UNI: Record<number, string> = { 0.125: "⅛", 0.25: "¼", 0.375: "⅜", 0.5: "½", 0.625: "⅝", 0.75: "¾", 0.875: "⅞" };
function sizeAsPrinted(v: number | null, text: string) {
  if (v == null) return null;
  const whole = Math.floor(v);
  const frac = formatInches(v).replace('"', "");
  const cands = [frac, frac.replace(" ", "-"), `${whole}${UNI[v - whole] ?? ""}`, v.toFixed(3), String(v)];
  return cands.find((c) => textContains(text, c)) ?? frac;
}

let n = 0;
const msg = (content: Message["content"], stop: Message["stop_reason"]): Message =>
  ({ id: `mock_${++n}`, type: "message", role: "assistant", model: "mock", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } }) as unknown as Message;
const text = (t: string) => msg([{ type: "text", text: t, citations: null } as never], "end_turn");
const toolUses = (calls: { name: string; input: Record<string, unknown> }[]) =>
  msg(calls.map((c) => ({ type: "tool_use", id: `toolu_mock_${++n}`, name: c.name, input: c.input }) as never), "tool_use");

function mockExtract(prompt: string): Message {
  const invoiceText = prompt.split("<invoice_text>")[1]?.split("</invoice_text>")[0] ?? prompt;
  const gt = groundTruths().find((g) => textContains(invoiceText, g.invoice_number));
  if (!gt) return text(JSON.stringify({ supplier_name: null, invoice_number: null, invoice_date: null, sidemark: null, po_number: null, lines: [] }));
  const ambiguous = new Set(gt.expected_issues.filter((i) => i.kind === "ambiguous").map((i) => `${i.line_no}:${i.field}`));
  const lines: ExtractedLine[] = gt.lines.map((l) => ({
    line_no: l.line_no,
    source_text: invoiceText.trim(),
    room: l.printed.room,
    product_type: l.printed.product_type,
    sku: l.printed.sku,
    width_text: sizeAsPrinted(l.printed.width, invoiceText),
    height_text: sizeAsPrinted(l.printed.height, invoiceText),
    mount: l.printed.mount,
    lift: l.printed.lift,
    control_side: l.printed.control_side,
    fabric_code: l.printed.fabric_code,
    colour_code: l.printed.colour_code,
    valance: l.printed.valance,
    motor_code: l.printed.motor_code,
    remote_code: l.printed.remote_code,
    uncertain: ambiguous.has(`${l.line_no}:colour_code`) ? [{ field: "colour_code", note: "colour name matches more than one fabric" }] : [],
  }));
  const ex: Extraction = { supplier_name: null, invoice_number: gt.invoice_number, invoice_date: null, sidemark: gt.sidemark, po_number: null, lines };
  return text(JSON.stringify(ex));
}

function mockAct(messages: Anthropic.Beta.Messages.BetaMessageParam[]): Message {
  const summary = JSON.parse(messages[0].content as string) as {
    invoice: { supplier_code: string; invoice_number: string; sidemark: string };
    lines: { line_key: string }[];
  };
  const last = messages[messages.length - 1];
  if (messages.length === 1) return toolUses([{ name: "find_customer", input: { query: summary.invoice.sidemark } }]);
  const prevAssistant = messages[messages.length - 2];
  const used = (prevAssistant.content as { type: string; name?: string }[]).filter((b) => b.type === "tool_use").map((b) => b.name);
  const results = (last.content as { type: string; content?: string }[]).filter((b) => b.type === "tool_result").map((b) => JSON.parse(b.content ?? "{}"));
  const addLines = (orderId: string) => toolUses(summary.lines.map((l) => ({ name: "add_or_update_line", input: { order_id: orderId, line_key: l.line_key } })));
  switch (used[0]) {
    case "find_customer": {
      const job = summary.invoice.sidemark.match(/J-\d+/)?.[0];
      const c = (results[0].customers as { id: string; job_no: string }[]).find((x) => x.job_no === job);
      if (!c) return text("No customer matches the sidemark; stopping.");
      (globalThis as { __mockCustomer?: string }).__mockCustomer = c.id;
      return toolUses([{ name: "find_order", input: { supplier: summary.invoice.supplier_code, invoice_number: summary.invoice.invoice_number } }]);
    }
    case "find_order":
      if (results[0].found) return addLines(results[0].order.id);
      return toolUses([{ name: "create_order", input: { customer_id: (globalThis as { __mockCustomer?: string }).__mockCustomer!, supplier: summary.invoice.supplier_code, invoice_number: summary.invoice.invoice_number } }]);
    case "create_order":
      if (!results[0].ok) return text(`create_order failed: ${results[0].error}`);
      return addLines(results[0].order.id);
    case "add_or_update_line": {
      const done = results.every((r) => r.ok && r.status === "complete" && r.verification?.ok);
      if (!done) return text("Order lines written; some lines still need information from the salesperson.");
      const orderId = (prevAssistant.content as { type: string; input?: { order_id: string } }[]).find((b) => b.type === "tool_use")!.input!.order_id;
      return toolUses([{ name: "set_status_for_review", input: { order_id: orderId } }]);
    }
    default:
      return text(results[0]?.ok ? "Order handed to office review." : `Stopped: ${results[0]?.error ?? "unknown"}`);
  }
}

export function mockModel(): ModelClient {
  return {
    name: "mock",
    async create(params, purpose) {
      if (purpose === "extract") return mockExtract(params.messages[0].content as string);
      if (purpose === "act") return mockAct(params.messages);
      return text(JSON.stringify({ value: "UNCLEAR" }));
    },
  };
}
