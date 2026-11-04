import { describe, expect, it } from "vitest";
import { invoiceFingerprint, lineKey, linesHash, normInvoiceNo } from "@/lib/worker/fingerprint";
import { emptyValues, type LineValues } from "@/lib/worker/types";

const line = (o: Partial<LineValues>): LineValues => ({ ...emptyValues(), sku: "NF-RS-210", room: "Kitchen", width: 34.625, height: 60, ...o });
const lines = [{ line_no: 1, values: line({}) }, { line_no: 2, values: line({ room: "Den", width: 20 }) }];

describe("invoice fingerprint", () => {
  it("is stable for an identical re-send (order, case and spacing of rooms don't matter)", () => {
    const resend = [{ line_no: 2, values: line({ room: "  den ", width: 20 }) }, { line_no: 1, values: line({ room: "KITCHEN" }) }];
    expect(invoiceFingerprint("NFS", "NF-24103", resend)).toBe(invoiceFingerprint("NFS", "NF-24103", lines));
  });
  it("normalises the invoice number", () => {
    expect(normInvoiceNo("Invoice No. nf-24103")).toBe("NF24103");
    expect(invoiceFingerprint("NFS", "nf 24103", lines)).toBe(invoiceFingerprint("NFS", "NF-24103", lines));
  });
  it("changes when any line value changes", () => {
    const base = invoiceFingerprint("NFS", "NF-24103", lines);
    expect(invoiceFingerprint("NFS", "NF-24103", [lines[0], { line_no: 2, values: line({ room: "Den", width: 20.125 }) }])).not.toBe(base);
    expect(invoiceFingerprint("NFS", "NF-24103", [lines[0]])).not.toBe(base);
    expect(invoiceFingerprint("NFS", "NF-24103", [lines[0], { line_no: 2, values: line({ room: "Den", width: 20, control_side: "left" }) }])).not.toBe(base);
  });
  it("differs by supplier and invoice number", () => {
    expect(invoiceFingerprint("BWB", "NF-24103", lines)).not.toBe(invoiceFingerprint("NFS", "NF-24103", lines));
    expect(invoiceFingerprint("NFS", "NF-24104", lines)).not.toBe(invoiceFingerprint("NFS", "NF-24103", lines));
  });
  it("hashes lines independently of the invoice number", () => expect(linesHash(lines)).toMatch(/^[0-9a-f]{64}$/));
  it("gives each line a stable unique key", () => {
    expect(lineKey("NFS", "NF-24103", 2)).toBe("NFS-NF24103-L2");
    expect(lineKey("NFS", "nf 24103", 2)).toBe(lineKey("NFS", "NF-24103", 2));
  });
});
