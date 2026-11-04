// Deterministic validation against the supplier's product rules.
// It flags problems; it never picks a replacement value. Invalid values are kept out
// of the order (left empty) until a person answers.
import {
  LABELS,
  LIFTS,
  MOUNTS,
  SIDES,
  VALANCES,
  controlSideRequired,
  findProduct,
  type Lift,
  type Product,
  type Supplier,
} from "../catalog";
import { formatInches, parseInches } from "../fractions";
import { FIELD_LABEL, emptyValues, type ExtractedLine, type Issue, type LineField, type LineValues } from "./types";

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const wordRe = (alias: string) =>
  new RegExp(`(^|[^a-z0-9])${alias.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}([^a-z0-9]|$)`, "i");

/** True when the (normalised) needle appears in the haystack. Used to confirm values against invoice text. */
export function textContains(haystack: string, needle: string) {
  const n = alnum(needle);
  return n.length > 0 && alnum(haystack).includes(n);
}

function aliasPresent(source: string, aliases: string[] | undefined) {
  return (aliases ?? []).some((a) => wordRe(a).test(source));
}

/**
 * Turns the model's extraction of one line into exact values plus issues.
 * - widths/heights: parsed here, not by the model
 * - product type: derived from the SKU via the catalog
 * - every option value must be traceable to the line's own invoice text (evidence check)
 * - fields the model marked uncertain are not used
 */
export function normalizeLine(supplier: Supplier, ext: ExtractedLine, invoiceText: string): { values: LineValues; issues: Issue[] } {
  const v = emptyValues();
  const issues: Issue[] = [];
  const src = ext.source_text ?? "";
  const sourceOnInvoice = src.length > 0 && textContains(invoiceText, src);
  const uncertain = new Map<string, string>();
  for (const u of ext.uncertain ?? []) uncertain.set(normField(u.field), u.note);

  const accept = <K extends keyof LineValues>(field: K & LineField, value: LineValues[K] | null, evidence: boolean, shown: string | null) => {
    if (value == null || value === "") return;
    if (uncertain.has(field)) {
      issues.push({ field, kind: "ambiguous", message: `The invoice is unclear about the ${FIELD_LABEL[field]}: ${uncertain.get(field)}`, invoiceValue: shown });
      return;
    }
    if (!sourceOnInvoice || !evidence) {
      issues.push({ field, kind: "unconfirmed", message: `The worker read "${shown}" for ${FIELD_LABEL[field]} but could not find it on the invoice line, so it was not used.`, invoiceValue: shown });
      return;
    }
    v[field] = value;
  };

  v.room = ext.room?.trim() || null;
  if (v.room && uncertain.has("room")) v.room = null;

  const sku = ext.sku?.trim().toUpperCase() || null;
  accept("sku", sku, !!sku && textContains(src, sku), sku);
  const product = findProduct(supplier, v.sku);
  if (product) v.product_type = product.type;

  for (const dim of ["width", "height"] as const) {
    const raw = dim === "width" ? ext.width_text : ext.height_text;
    if (raw == null || raw.trim() === "") continue;
    const parsed = parseInches(raw);
    if (!parsed.ok) {
      issues.push({ field: dim, kind: "unreadable", message: `Could not read the ${dim} "${raw}" (${parsed.error}).`, invoiceValue: raw });
      continue;
    }
    accept(dim, parsed.value, textContains(src, raw.replace(/["″]/g, "")) || textContains(src, String(parsed.value)), raw);
  }

  accept("mount", ext.mount, !!ext.mount && aliasPresent(src, supplier.aliases.mount[ext.mount]), ext.mount);
  accept("lift", ext.lift, !!ext.lift && aliasPresent(src, supplier.aliases.lift[ext.lift]), ext.lift);
  accept("control_side", ext.control_side, !!ext.control_side && aliasPresent(src, supplier.aliases.side[ext.control_side]), ext.control_side);
  accept("valance", ext.valance, !!ext.valance && aliasPresent(src, supplier.aliases.valance[ext.valance]), ext.valance);

  const fabricCode = ext.fabric_code?.trim().toUpperCase() || null;
  const fabric = product?.fabrics.find((f) => f.code === fabricCode);
  accept("fabric_code", fabricCode, !!fabricCode && (textContains(src, fabricCode) || (!!fabric && textContains(src, fabric.name))), fabricCode);

  const colourCode = ext.colour_code?.trim().toUpperCase() || null;
  const colourEvidence =
    !!colourCode &&
    (wordRe(colourCode).test(src) ||
      (product?.fabrics ?? []).some((f) => f.colours.some((c) => c.code === colourCode && wordRe(c.name).test(src))));
  accept("colour_code", colourCode, colourEvidence, colourCode);

  const motor = ext.motor_code?.trim().toUpperCase() || null;
  accept("motor_code", motor, !!motor && textContains(src, motor), motor);
  const remote = ext.remote_code?.trim().toUpperCase() || null;
  accept("remote_code", remote, !!remote && textContains(src, remote), remote);

  // the model left a field empty and said why: surface it as an ambiguity, not just "missing"
  for (const [field, note] of uncertain) {
    if (!(field in v) || (v as unknown as Record<string, unknown>)[field] != null || issues.some((i) => i.field === field)) continue;
    issues.push({ field: field as LineField, kind: "ambiguous", message: `The invoice is unclear about the ${FIELD_LABEL[field as LineField]}: ${note}` });
  }
  return { values: v, issues };
}

function normField(f: string): string {
  const s = f.toLowerCase().replace(/\s+/g, "_");
  const map: Record<string, LineField> = {
    colour: "colour_code", color: "colour_code", color_code: "colour_code", fabric: "fabric_code", motor: "motor_code", remote: "remote_code",
    side: "control_side", control: "control_side", width_text: "width", height_text: "height", size: "width",
  };
  return map[s] ?? s;
}

/**
 * Checks a line's values against the catalog. Returns issues; invalid values are reported with
 * `invoiceValue` and should be cleared by the caller (see `clearInvalid`).
 */
export function validateLine(supplier: Supplier, v: LineValues): Issue[] {
  const issues: Issue[] = [];
  const miss = (field: LineField, message: string) => issues.push({ field, kind: "missing", message });
  const bad = (field: LineField, message: string, value: unknown) =>
    issues.push({ field, kind: "invalid", message, invoiceValue: value == null ? null : String(value) });

  if (!v.room) miss("room", "No room label for this window.");
  if (!v.sku) {
    miss("sku", "No product SKU on this line.");
    return issues;
  }
  const p = findProduct(supplier, v.sku);
  if (!p) {
    bad("sku", `SKU ${v.sku} is not in the ${supplier.name} catalog.`, v.sku);
    return issues;
  }

  if (v.width == null) miss("width", "Width is missing.");
  if (v.height == null) miss("height", "Height is missing.");

  if (!v.mount) miss("mount", "Mount (inside / outside) is missing.");
  else if (!MOUNTS.includes(v.mount) || !p.mounts.includes(v.mount)) bad("mount", `${p.name} is ${p.mounts.map((m) => LABELS.mount[m].toLowerCase()).join(" or ")} only; the invoice says ${LABELS.mount[v.mount]?.toLowerCase() ?? v.mount}.`, v.mount);

  let liftOk = false;
  if (p.type === "shutter") {
    if (v.lift) bad("lift", `${p.name} is a shutter and has no lift system; the invoice says ${LABELS.lift[v.lift] ?? v.lift}.`, v.lift);
    else liftOk = true;
  } else if (!v.lift) miss("lift", "Lift system is missing.");
  else if (!LIFTS.includes(v.lift) || !p.lifts[v.lift]) bad("lift", `${LABELS.lift[v.lift] ?? v.lift} is not offered on ${p.name} (available: ${availableLifts(p)}).`, v.lift);
  else liftOk = true;

  if (liftOk) {
    const lim = p.type === "shutter" ? p.fixed! : p.lifts[v.lift as Lift]!;
    const what = p.type === "shutter" ? p.name : `${p.name} with ${LABELS.lift[v.lift as Lift].toLowerCase()}`;
    if (v.width != null && (v.width < lim.minW || v.width > lim.maxW))
      bad("width", `Width ${formatInches(v.width)} is outside ${formatInches(lim.minW)}–${formatInches(lim.maxW)} for ${what}.`, formatInches(v.width));
    if (v.height != null && (v.height < lim.minH || v.height > lim.maxH))
      bad("height", `Height ${formatInches(v.height)} is outside ${formatInches(lim.minH)}–${formatInches(lim.maxH)} for ${what}.`, formatInches(v.height));
  }

  if (!v.control_side && controlSideRequired(p, liftOk ? v.lift : null) && (liftOk || p.controlSideFor.includes("always")))
    miss("control_side", `${p.controlSideLabel} is required for this product${v.lift ? ` with ${LABELS.lift[v.lift].toLowerCase()}` : ""}.`);
  else if (v.control_side && !SIDES.includes(v.control_side)) bad("control_side", `Unknown control side "${v.control_side}".`, v.control_side);

  const fabric = p.fabrics.find((f) => f.code === v.fabric_code);
  if (!v.fabric_code) miss("fabric_code", `${p.fabricLabel} is missing.`);
  else if (!fabric) bad("fabric_code", `${p.fabricLabel} ${v.fabric_code} is not offered on ${p.name}.`, v.fabric_code);

  if (!v.colour_code) miss("colour_code", "Colour is missing.");
  else if (fabric && !fabric.colours.some((c) => c.code === v.colour_code))
    bad("colour_code", `Colour ${v.colour_code} is not available in ${fabric.name} (available: ${fabric.colours.map((c) => `${c.code} ${c.name}`).join(", ")}).`, v.colour_code);

  if (v.valance && (!VALANCES.includes(v.valance) || !p.valances.includes(v.valance)))
    bad("valance", `${LABELS.valance[v.valance] ?? v.valance} is not offered on ${p.name}${p.valances.length ? ` (available: ${p.valances.map((x) => LABELS.valance[x]).join(", ")})` : ""}.`, v.valance);

  const motorized = v.lift === "motorized";
  const motor = supplier.motors.find((m) => m.code === v.motor_code);
  if (motorized && liftOk) {
    if (!v.motor_code) miss("motor_code", "Motorized, but no motor is specified.");
    else if (!motor || !p.motors.includes(motor.code)) bad("motor_code", `Motor ${v.motor_code} is not compatible with ${p.name} (compatible: ${p.motors.join(", ")}).`, v.motor_code);
    if (!v.remote_code) miss("remote_code", "Motorized, but no remote or hub is specified.");
    else if (motor && !motor.remotes.includes(v.remote_code)) bad("remote_code", `Remote ${v.remote_code} does not work with motor ${motor.code} (works with: ${motor.remotes.join(", ")}).`, v.remote_code);
    else if (!supplier.remotes.some((r) => r.code === v.remote_code)) bad("remote_code", `Remote ${v.remote_code} is not in the ${supplier.name} catalog.`, v.remote_code);
  } else if (!motorized) {
    if (v.motor_code) bad("motor_code", `A motor (${v.motor_code}) is listed but the lift is not motorized.`, v.motor_code);
    if (v.remote_code) bad("remote_code", `A remote (${v.remote_code}) is listed but the lift is not motorized.`, v.remote_code);
  }
  return issues;
}

export function availableLifts(p: Product) {
  return (Object.keys(p.lifts) as Lift[]).map((l) => LABELS.lift[l].toLowerCase()).join(", ") || "none";
}

/** Invalid values never reach the order: clear them so the line waits for an answer. */
export function clearInvalid(v: LineValues, issues: Issue[]): LineValues {
  const out = { ...v };
  for (const i of issues) if (i.kind !== "missing") (out as Record<string, unknown>)[i.field] = null;
  return out;
}

/**
 * Full deterministic pass for one line: normalise → validate → clear invalid values.
 * Returns the values that may be written and all open issues (one per field, first wins).
 */
export function checkLine(supplier: Supplier, v: LineValues, preIssues: Issue[] = []) {
  const issues = dedupeByField([...preIssues, ...validateLine(supplier, v)]);
  return { values: clearInvalid(v, issues), issues };
}

export function dedupeByField(issues: Issue[]) {
  const seen = new Map<LineField, Issue>();
  for (const i of issues) {
    const prev = seen.get(i.field);
    // a specific problem beats "missing" (e.g. unconfirmed value → also reported as missing)
    if (!prev || (prev.kind === "missing" && i.kind !== "missing")) seen.set(i.field, i);
  }
  return [...seen.values()];
}
