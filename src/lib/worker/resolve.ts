// Computes what an order line SHOULD contain: validated invoice values + the salesperson's answers.
// This is the only source of values the write tools use; the model never supplies field values.
import { q } from "../db";
import { findProduct, supplierByCode, type Supplier } from "../catalog";
import { checkLine } from "./validate";
import { LINE_FIELDS, type Issue, type LineField, type LineValues } from "./types";

export interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  line_no: number;
  line_key: string;
  extracted: Record<string, unknown>;
  normalized: LineValues;
  pre_issues: Issue[];
  issues: Issue[];
}

export interface AnswerRow {
  field: LineField;
  value: unknown;
  answer_text: string;
  answered_by: string;
  created_at: string;
}

export type Provenance = Partial<Record<LineField, { source: "invoice" | "salesperson"; by?: string; at?: string; answer?: string; invoice_value?: string | null }>>;

export interface ResolvedLine {
  line_key: string;
  line_no: number;
  values: LineValues;
  issues: Issue[];
  provenance: Provenance;
}

export async function answersFor(ws: string, lineKey: string) {
  return q<AnswerRow>(
    "select field, value, answer_text, answered_by, created_at from answers where ws = $1 and line_key = $2 and value is not null order by created_at, id",
    [ws, lineKey],
  );
}

export function resolveWith(supplier: Supplier, il: Pick<InvoiceLineRow, "line_key" | "line_no" | "normalized" | "pre_issues">, answers: AnswerRow[]): ResolvedLine {
  const values: LineValues = { ...il.normalized };
  const answered = new Map<LineField, AnswerRow>();
  for (const a of answers) answered.set(a.field, a); // latest wins
  for (const [field, a] of answered) (values as unknown as Record<string, unknown>)[field] = a.value;
  // product type always follows the (possibly answered) SKU, from the catalog
  values.product_type = findProduct(supplier, values.sku)?.type ?? values.product_type;
  const pre = il.pre_issues.filter((i) => !answered.has(i.field));
  const { values: writable, issues } = checkLine(supplier, values, pre);
  const provenance: Provenance = {};
  const invoiceIssue = new Map(il.pre_issues.map((i) => [i.field, i]));
  for (const f of LINE_FIELDS) {
    const a = answered.get(f);
    const invVal = (il.normalized as unknown as Record<string, unknown>)[f];
    const invoice_value = invoiceIssue.get(f)?.invoiceValue ?? (invVal == null ? null : String(invVal));
    if (a) provenance[f] = { source: "salesperson", by: a.answered_by, at: a.created_at, answer: a.answer_text, invoice_value };
    else if ((writable as unknown as Record<string, unknown>)[f] != null) provenance[f] = { source: "invoice" };
  }
  return { line_key: il.line_key, line_no: il.line_no, values: writable, issues, provenance };
}

export async function resolveLine(ws: string, supplierCode: string, il: InvoiceLineRow): Promise<ResolvedLine> {
  const supplier = supplierByCode(supplierCode);
  if (!supplier) throw new Error(`unknown supplier ${supplierCode}`);
  return resolveWith(supplier, il, await answersFor(ws, il.line_key));
}

export async function invoiceLines(invoiceId: string) {
  return q<InvoiceLineRow>("select * from invoice_lines where invoice_id = $1 order by line_no", [invoiceId]);
}

export async function resolveInvoice(ws: string, supplierCode: string, invoiceId: string) {
  const lines = await invoiceLines(invoiceId);
  return Promise.all(lines.map((l) => resolveLine(ws, supplierCode, l)));
}
