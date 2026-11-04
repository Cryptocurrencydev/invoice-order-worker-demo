// All model calls go through `ModelClient.create` so tests and the e2e mock can replace it.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { LIFTS, MOUNTS, PRODUCT_TYPES, SIDES, VALANCES } from "../catalog";
import type { Extraction } from "./types";

export type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export type Message = Anthropic.Beta.Messages.BetaMessage;

export interface ModelClient {
  name: string;
  create(params: Omit<CreateParams, "model">, purpose: "extract" | "act" | "interpret" | "baseline"): Promise<Message>;
}

export const MODEL_ID = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

export function anthropicClient(): ModelClient {
  const client = new Anthropic({ maxRetries: 3, timeout: 120_000 });
  return {
    name: MODEL_ID,
    async create(params) {
      return client.beta.messages.create({
        ...params,
        model: MODEL_ID,
        // server-side fallback if a request is ever declined by a safety classifier
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as CreateParams);
    },
  };
}

// ---------- extraction ----------
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const str = { type: "string" };
const enumOf = (values: readonly string[]) => ({ type: "string", enum: [...values] });

export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["supplier_name", "invoice_number", "invoice_date", "sidemark", "po_number", "lines"],
  properties: {
    // header fields are plain strings ("" when absent) to stay within the structured-output union limit
    supplier_name: str,
    invoice_number: str,
    invoice_date: str,
    sidemark: str,
    po_number: str,
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["line_no", "source_text", "room", "product_type", "sku", "width_text", "height_text", "mount", "lift", "control_side", "fabric_code", "colour_code", "valance", "motor_code", "remote_code", "uncertain"],
        properties: {
          line_no: { type: "integer" },
          source_text: str,
          room: nullable(str),
          product_type: nullable(enumOf(PRODUCT_TYPES)),
          sku: nullable(str),
          width_text: nullable(str),
          height_text: nullable(str),
          mount: nullable(enumOf(MOUNTS)),
          lift: nullable(enumOf(LIFTS)),
          control_side: nullable(enumOf(SIDES)),
          fabric_code: nullable(str),
          colour_code: nullable(str),
          valance: nullable(enumOf(VALANCES)),
          motor_code: nullable(str),
          remote_code: nullable(str),
          uncertain: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["field", "note"], properties: { field: str, note: str } },
          },
        },
      },
    },
  },
} as const;

const header = z.string().nullable().transform((v) => (v && v.trim() ? v.trim() : null));
const ExtractionZ = z.object({
  supplier_name: header,
  invoice_number: header,
  invoice_date: header,
  sidemark: header,
  po_number: header,
  lines: z.array(
    z.object({
      line_no: z.number().int(),
      source_text: z.string(),
      room: z.string().nullable(),
      product_type: z.enum(PRODUCT_TYPES).nullable(),
      sku: z.string().nullable(),
      width_text: z.string().nullable(),
      height_text: z.string().nullable(),
      mount: z.enum(MOUNTS).nullable(),
      lift: z.enum(LIFTS).nullable(),
      control_side: z.enum(SIDES).nullable(),
      fabric_code: z.string().nullable(),
      colour_code: z.string().nullable(),
      valance: z.enum(VALANCES).nullable(),
      motor_code: z.string().nullable(),
      remote_code: z.string().nullable(),
      uncertain: z.array(z.object({ field: z.string(), note: z.string() })),
    }),
  ),
});

export const EXTRACT_SYSTEM = `You read supplier invoices for Harbor & Pine Window Studio, a custom window covering dealer, and transcribe every window line into the JSON schema. You are a careful transcriber, not an editor.

Rules:
- One entry per window line, in invoice order. line_no = the line/item number printed on the invoice.
- source_text: copy all of the invoice text that belongs to this line, verbatim and in order (it may span several text lines; join them with spaces).
- width_text / height_text: copy the measurement exactly as printed ("34 5/8", "34-5/8", "34⅝", "34.625"). Do not convert, round or do arithmetic. If a size is missing or shows TBD, use null.
- mount, lift, control_side, valance: map the supplier's printed abbreviations to the enum values using the supplier's "How we write options on invoices" table. A shutter has no lift: lift = null.
- sku, fabric_code, colour_code, motor_code, remote_code: the catalog codes printed on the line. If the invoice prints only a colour or fabric NAME, use the code only when that name identifies exactly one code for that product (and fabric, if known); otherwise null.
- Copy what is printed even if it looks wrong for the product (e.g. an option the product doesn't offer, an incompatible remote, a size out of range). Do not fix it; separate validation code checks it.
- Never fill in a value that is not printed on the line. Missing → null.
- uncertain: for any field you left null because the invoice is ambiguous or illegible (not simply absent), or a value you are unsure you read correctly, add {field, note} explaining why in a few words. Use field names from the schema (e.g. "colour_code", "width").`;

export async function extractInvoice(model: ModelClient, invoiceText: string, supplierDoc: string): Promise<Extraction> {
  const res = await model.create(
    {
      max_tokens: 16000,
      system: EXTRACT_SYSTEM,
      output_config: { effort: "medium", format: { type: "json_schema", schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown> } },
      messages: [
        {
          role: "user",
          content: `<supplier_product_reference>\n${supplierDoc}\n</supplier_product_reference>\n\n<invoice_text>\n${invoiceText}\n</invoice_text>\n\nTranscribe the invoice.`,
        },
      ],
    },
    "extract",
  );
  if (res.stop_reason === "refusal") throw new Error("model declined to read this invoice");
  if (res.stop_reason === "max_tokens") throw new Error("extraction was cut off (max_tokens)");
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("no extraction returned");
  return ExtractionZ.parse(JSON.parse(text.text)) as Extraction;
}

// ---------- answer interpretation ----------
export async function interpretAnswer(
  model: ModelClient,
  question: string,
  options: { value: string; label: string }[],
  answer: string,
): Promise<string | null> {
  const values = [...options.map((o) => o.value), "UNCLEAR"];
  const res = await model.create(
    {
      max_tokens: 2000,
      system:
        "A salesperson answered a question about one line of a window covering order. Map the answer to exactly one of the allowed option values. If the answer does not clearly pick one option, return UNCLEAR. Never pick an option the salesperson didn't indicate.",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: { type: "object", additionalProperties: false, required: ["value"], properties: { value: { type: "string", enum: values } } } },
      },
      messages: [
        {
          role: "user",
          content: `Question: ${question}\nAllowed options:\n${options.map((o) => `- ${o.value}: ${o.label}`).join("\n")}\n\nSalesperson's answer: ${JSON.stringify(answer)}`,
        },
      ],
    },
    "interpret",
  );
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  const v = (JSON.parse(text.text) as { value: string }).value;
  return v === "UNCLEAR" || !options.some((o) => o.value === v) ? null : v;
}
