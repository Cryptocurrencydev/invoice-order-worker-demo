import { createHash } from "node:crypto";
import type { LineValues } from "./types";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function normInvoiceNo(no: string | null | undefined) {
  return (no ?? "").toUpperCase().replace(/^(INVOICE|INV)\s*(NO\.?|#)?\s*/, "").replace(/[^A-Z0-9]/g, "");
}

/** Canonical form of one line: order-independent of key order, case and whitespace. */
function canonicalLine(lineNo: number, v: LineValues) {
  return [
    lineNo,
    v.sku ?? "",
    (v.room ?? "").toLowerCase().replace(/\s+/g, " ").trim(),
    v.width ?? "",
    v.height ?? "",
    v.mount ?? "",
    v.lift ?? "",
    v.control_side ?? "",
    v.fabric_code ?? "",
    v.colour_code ?? "",
    v.valance ?? "",
    v.motor_code ?? "",
    v.remote_code ?? "",
  ].join("|");
}

export function linesHash(lines: { line_no: number; values: LineValues }[]) {
  const canon = [...lines].sort((a, b) => a.line_no - b.line_no).map((l) => canonicalLine(l.line_no, l.values));
  return sha(canon.join("\n"));
}

/** supplier + invoice number + hash of lines. Identical re-sends produce the same fingerprint. */
export function invoiceFingerprint(supplier: string, invoiceNo: string, lines: { line_no: number; values: LineValues }[]) {
  return sha(`${supplier}|${normInvoiceNo(invoiceNo)}|${linesHash(lines)}`);
}

/** Stable unique key per order line: a re-processed invoice updates the same line instead of adding one. */
export function lineKey(supplier: string, invoiceNo: string, lineNo: number) {
  return `${supplier}-${normInvoiceNo(invoiceNo)}-L${lineNo}`;
}
