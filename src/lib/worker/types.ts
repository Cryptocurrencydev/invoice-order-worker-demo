import type { Lift, Mount, ProductType, Side, Valance } from "../catalog";

export const LINE_FIELDS = [
  "room",
  "product_type",
  "sku",
  "width",
  "height",
  "mount",
  "lift",
  "control_side",
  "fabric_code",
  "colour_code",
  "valance",
  "motor_code",
  "remote_code",
] as const;
export type LineField = (typeof LINE_FIELDS)[number];

/** Fields the salesperson can be asked about (product_type is derived from the SKU). */
export const ASKABLE_FIELDS: LineField[] = LINE_FIELDS.filter((f) => f !== "product_type");

export const FIELD_LABEL: Record<LineField, string> = {
  room: "room",
  product_type: "product",
  sku: "SKU",
  width: "width",
  height: "height",
  mount: "mount",
  lift: "lift system",
  control_side: "control side",
  fabric_code: "fabric",
  colour_code: "colour",
  valance: "valance",
  motor_code: "motor",
  remote_code: "remote",
};

/** One window line as the model extracted it: text copied from the invoice, options mapped to catalog codes. */
export interface ExtractedLine {
  line_no: number;
  source_text: string;
  room: string | null;
  product_type: ProductType | null;
  sku: string | null;
  width_text: string | null;
  height_text: string | null;
  mount: Mount | null;
  lift: Lift | null;
  control_side: Side | null;
  fabric_code: string | null;
  colour_code: string | null;
  valance: Valance | null;
  motor_code: string | null;
  remote_code: string | null;
  uncertain: { field: string; note: string }[];
}

export interface Extraction {
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  sidemark: string | null;
  po_number: string | null;
  lines: ExtractedLine[];
}

/** Normalised values for one order line (exact numbers, catalog codes). */
export interface LineValues {
  room: string | null;
  product_type: ProductType | null;
  sku: string | null;
  width: number | null;
  height: number | null;
  mount: Mount | null;
  lift: Lift | null;
  control_side: Side | null;
  fabric_code: string | null;
  colour_code: string | null;
  valance: Valance | null;
  motor_code: string | null;
  remote_code: string | null;
}

export type IssueKind = "missing" | "invalid" | "ambiguous" | "unconfirmed" | "unreadable";

export interface Issue {
  field: LineField;
  kind: IssueKind;
  message: string;
  /** what the invoice said, if anything (kept for the review diff; never written to the order) */
  invoiceValue?: string | null;
}

export function emptyValues(): LineValues {
  return {
    room: null,
    product_type: null,
    sku: null,
    width: null,
    height: null,
    mount: null,
    lift: null,
    control_side: null,
    fabric_code: null,
    colour_code: null,
    valance: null,
    motor_code: null,
    remote_code: null,
  };
}
