import { describe, expect, it } from "vitest";
import { supplierByCode } from "@/lib/catalog";
import { checkLine, normalizeLine, validateLine } from "@/lib/worker/validate";
import { matchAnswerDeterministic, questionText } from "@/lib/worker/questions";
import type { ExtractedLine, LineValues } from "@/lib/worker/types";

const NFS = supplierByCode("NFS")!;
const BWB = supplierByCode("BWB")!;
const LWF = supplierByCode("LWF")!;

const roller: LineValues = {
  room: "Kitchen", product_type: "roller_shade", sku: "NF-RS-210", width: 34.625, height: 60, mount: "inside", lift: "continuous_loop",
  control_side: "left", fabric_code: "SOL-L", colour_code: "L02", valance: "cassette", motor_code: null, remote_code: null,
};
const kinds = (v: LineValues, s = NFS) => validateLine(s, v).map((i) => `${i.kind}:${i.field}`);

describe("validateLine", () => {
  it("accepts a valid line", () => expect(validateLine(NFS, roller)).toEqual([]));

  it("flags missing required options", () => {
    expect(kinds({ ...roller, control_side: null })).toEqual(["missing:control_side"]);
    expect(kinds({ ...roller, mount: null, colour_code: null })).toEqual(["missing:mount", "missing:colour_code"]);
  });

  it("does not require a control side for cordless roller shades", () => expect(kinds({ ...roller, lift: "cordless", control_side: null })).toEqual([]));

  it("requires a tilt side on every faux wood blind", () => {
    const fw: LineValues = { room: "Den", product_type: "faux_wood_blind", sku: "BW-FW2", width: 30, height: 40, mount: "inside", lift: "cordless", control_side: null, fabric_code: "SM", colour_code: "101", valance: null, motor_code: null, remote_code: null };
    expect(kinds(fw, BWB)).toEqual(["missing:control_side"]);
  });

  it("flags a lift system the product does not offer", () => {
    const cell: LineValues = { ...roller, sku: "NF-CS-310", product_type: "cellular_shade", fabric_code: "HOL-LF", colour_code: "C31", valance: null };
    expect(kinds(cell)).toEqual(["invalid:lift"]);
  });

  it("checks size limits for the chosen lift", () => {
    expect(kinds({ ...roller, lift: "motorized", width: 18.5, motor_code: "NM-20", remote_code: "NR-1" })).toEqual(["invalid:width"]);
    expect(kinds({ ...roller, lift: "cordless", width: 80, control_side: null })).toEqual(["invalid:width"]);
    expect(kinds({ ...roller, height: 130 })).toEqual(["invalid:height"]);
  });

  it("checks motor and remote compatibility", () => {
    const m = { ...roller, sku: "NF-RS-240", fabric_code: "MER-B", colour_code: "B22", lift: "motorized" as const, width: 40 };
    expect(kinds({ ...m, motor_code: "NM-35", remote_code: "NR-1" })).toEqual(["invalid:remote_code"]);
    expect(kinds({ ...m, motor_code: null, remote_code: "NR-1" })).toEqual(["missing:motor_code"]);
    expect(kinds({ ...m, motor_code: "NM-20", remote_code: null })).toEqual(["missing:remote_code"]);
    expect(kinds({ ...m, motor_code: "ND-60", remote_code: "NR-5" })).toEqual(["invalid:motor_code"]);
    expect(kinds({ ...roller, motor_code: "NM-20" })).toEqual(["invalid:motor_code"]);
  });

  it("checks fabric/colour combinations", () => {
    expect(kinds({ ...roller, colour_code: "W11" })).toEqual(["invalid:colour_code"]);
    expect(kinds({ ...roller, fabric_code: "MER-B" })).toEqual(["invalid:fabric_code"]);
  });

  it("checks mount, valance and shutters", () => {
    const drape: LineValues = { room: "Living", product_type: "drapery", sku: "NF-DR-510", width: 90, height: 84, mount: "inside", lift: "continuous_loop", control_side: "left", fabric_code: "ARB", colour_code: "D51", valance: null, motor_code: null, remote_code: null };
    expect(kinds(drape)).toEqual(["invalid:mount"]);
    expect(kinds({ ...drape, mount: "outside", valance: "cassette" })).toEqual(["invalid:valance"]);
    const sh: LineValues = { room: "Office", product_type: "shutter", sku: "BW-SH35", width: 52.25, height: 40, mount: "inside", lift: null, control_side: null, fabric_code: "PV", colour_code: "301", valance: null, motor_code: null, remote_code: null };
    expect(kinds(sh, BWB)).toEqual(["invalid:width"]);
    expect(kinds({ ...sh, width: 40, lift: "cordless" }, BWB)).toEqual(["invalid:lift"]);
  });

  it("flags unknown SKUs and stops there", () => expect(kinds({ ...roller, sku: "NF-XX-1" })).toEqual(["invalid:sku"]));

  it("never writes an invalid value: checkLine clears it and keeps the invoice value for review", () => {
    const { values, issues } = checkLine(NFS, { ...roller, colour_code: "W11" });
    expect(values.colour_code).toBeNull();
    expect(issues[0]).toMatchObject({ field: "colour_code", kind: "invalid", invoiceValue: "W11" });
  });
});

const ext = (over: Partial<ExtractedLine>): ExtractedLine => ({
  line_no: 1, source_text: "1 Kitchen NF-RS-210 Solace Light-Filtering Roller SOL-L / L02 34 5/8 x 60 INS CLP L CAS VAL 1 $300.00",
  room: "Kitchen", product_type: "roller_shade", sku: "NF-RS-210", width_text: "34 5/8", height_text: "60", mount: "inside", lift: "continuous_loop",
  control_side: "left", fabric_code: "SOL-L", colour_code: "L02", valance: "cassette", motor_code: null, remote_code: null, uncertain: [], ...over,
});
const invoiceText = "Northfold Shade Co.\n1 Kitchen NF-RS-\n210 Solace Light-Filtering Roller SOL-L /\nL02 34 5/8 x 60 INS CLP L CAS VAL 1 $300.00";

describe("normalizeLine (deterministic, evidence-checked)", () => {
  it("parses sizes in code and derives the product from the SKU", () => {
    const { values, issues } = normalizeLine(NFS, ext({ product_type: "drapery" }), invoiceText);
    expect(issues).toEqual([]);
    expect(values).toMatchObject({ width: 34.625, height: 60, product_type: "roller_shade" });
  });

  it("rejects values that are not on the invoice line (no invented options)", () => {
    const { values, issues } = normalizeLine(NFS, ext({ remote_code: "NR-5", colour_code: "L03" }), invoiceText);
    expect(values.remote_code).toBeNull();
    expect(values.colour_code).toBeNull();
    expect(issues.map((i) => `${i.kind}:${i.field}`)).toEqual(["unconfirmed:colour_code", "unconfirmed:remote_code"]);
  });

  it("rejects a source_text that is not on the invoice", () => {
    const { issues } = normalizeLine(NFS, ext({ source_text: "1 Kitchen NF-RS-210 made up line" }), invoiceText);
    expect(issues.length).toBeGreaterThan(5);
    expect(issues.every((i) => i.kind === "unconfirmed")).toBe(true);
  });

  it("drops fields the model marked uncertain", () => {
    const { values, issues } = normalizeLine(NFS, ext({ uncertain: [{ field: "colour", note: "smudged" }] }), invoiceText);
    expect(values.colour_code).toBeNull();
    expect(issues[0]).toMatchObject({ field: "colour_code", kind: "ambiguous" });
  });

  it("reports unreadable sizes instead of guessing", () => {
    const { values, issues } = normalizeLine(NFS, ext({ width_text: "457/8" }), invoiceText + " 457/8");
    expect(values.width).toBeNull();
    expect(issues[0]).toMatchObject({ field: "width", kind: "unreadable" });
  });
});

describe("questions", () => {
  it("builds one clear question with the valid options", () => {
    const t = questionText(NFS, 2, { ...roller, control_side: null }, { field: "control_side", kind: "missing", message: "Control side is required." });
    expect(t).toContain("Line 2 · Kitchen · Solace Light-Filtering Roller");
    expect(t).toContain("Options: Left / Right");
    expect(questionText(NFS, 2, roller, { field: "control_side", kind: "missing", message: "x" }, 2)).not.toEqual(t);
  });

  it("matches answers deterministically when unambiguous", () => {
    expect(matchAnswerDeterministic(NFS, roller, "control_side", "left side please")).toBe("left");
    expect(matchAnswerDeterministic(BWB, { ...roller, sku: "BW-FW2" }, "control_side", "RH")).toBe("right");
    expect(matchAnswerDeterministic(NFS, roller, "mount", "INS")).toBe("inside");
    expect(matchAnswerDeterministic(NFS, roller, "colour_code", "L03")).toBe("L03");
    expect(matchAnswerDeterministic(NFS, { ...roller, fabric_code: "SOL-W" }, "colour_code", "graphite")).toBe("W14");
    expect(matchAnswerDeterministic(NFS, roller, "width", "it's 42 1/4 actually")).toBe(42.25);
    expect(matchAnswerDeterministic(NFS, roller, "height", "60½ tall")).toBe(60.5);
    expect(matchAnswerDeterministic(LWF, { ...roller, sku: "LUM-ROL-50", fabric_code: null }, "colour_code", "white")).toBeNull(); // two whites
    expect(matchAnswerDeterministic(NFS, roller, "control_side", "not sure")).toBeNull();
  });
});

describe("resolveWith", () => {
  it("re-derives the product type when the salesperson answers the SKU", async () => {
    const { resolveWith } = await import("@/lib/worker/resolve");
    const normalized = { ...roller, sku: null, product_type: null };
    const r = resolveWith(NFS, { line_key: "k", line_no: 1, normalized, pre_issues: [{ field: "sku", kind: "ambiguous", message: "smudged" }] }, [
      { field: "sku", value: "NF-RS-210", answer_text: "NF-RS-210", answered_by: "Maya", created_at: "now" },
    ]);
    expect(r.values).toMatchObject({ sku: "NF-RS-210", product_type: "roller_shade" });
    expect(r.issues).toEqual([]);
    expect(r.provenance.sku).toMatchObject({ source: "salesperson", by: "Maya" });
  });
});
