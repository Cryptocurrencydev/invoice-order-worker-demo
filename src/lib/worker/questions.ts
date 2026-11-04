// One clear question per open issue, built deterministically from the issue and the catalog.
import { LABELS, LIFTS, MOUNTS, SIDES, findProduct, type Lift, type Supplier } from "../catalog";
import { formatInches, parseInches } from "../fractions";
import { FIELD_LABEL, type Issue, type LineField, type LineValues } from "./types";

export interface Option {
  value: string;
  label: string;
}

/** Valid choices for a field given the rest of the line (empty = free text, e.g. room or size). */
export function optionsFor(supplier: Supplier, v: LineValues, field: LineField): Option[] {
  const p = findProduct(supplier, v.sku);
  switch (field) {
    case "sku":
      return supplier.products.map((x) => ({ value: x.sku, label: `${x.sku} ${x.name}` }));
    case "mount":
      return (p?.mounts ?? [...MOUNTS]).map((m) => ({ value: m, label: LABELS.mount[m] }));
    case "lift":
      return (p ? (Object.keys(p.lifts) as Lift[]) : [...LIFTS]).map((l) => ({ value: l, label: LABELS.lift[l] }));
    case "control_side":
      return SIDES.map((s) => ({ value: s, label: LABELS.side[s] }));
    case "fabric_code":
      return (p?.fabrics ?? []).map((f) => ({ value: f.code, label: `${f.code} ${f.name}` }));
    case "colour_code": {
      const fabrics = p?.fabrics.filter((f) => !v.fabric_code || f.code === v.fabric_code) ?? [];
      return fabrics.flatMap((f) => f.colours.map((c) => ({ value: c.code, label: `${c.code} ${c.name}${fabrics.length > 1 ? ` (${f.name})` : ""}` })));
    }
    case "valance":
      return (p?.valances ?? []).map((x) => ({ value: x, label: LABELS.valance[x] }));
    case "motor_code":
      return supplier.motors.filter((m) => p?.motors.includes(m.code)).map((m) => ({ value: m.code, label: `${m.code} ${m.name}` }));
    case "remote_code": {
      const motor = supplier.motors.find((m) => m.code === v.motor_code);
      const codes = motor ? motor.remotes : supplier.remotes.map((r) => r.code);
      return supplier.remotes.filter((r) => codes.includes(r.code)).map((r) => ({ value: r.code, label: `${r.code} ${r.name}` }));
    }
    default:
      return [];
  }
}

export function lineLabel(lineNo: number, v: LineValues, supplier: Supplier) {
  const p = findProduct(supplier, v.sku);
  return `Line ${lineNo}${v.room ? ` · ${v.room}` : ""}${p ? ` · ${p.name}` : ""}`;
}

/**
 * The question text. `attempt` > 1 rephrases with the explicit option list, so the
 * worker never sends the same question twice for the same line and field.
 */
export function questionText(supplier: Supplier, lineNo: number, v: LineValues, issue: Issue, attempt = 1): string {
  const opts = optionsFor(supplier, v, issue.field);
  const head = lineLabel(lineNo, v, supplier);
  const choice = opts.length ? ` Options: ${opts.map((o) => o.label).join(" / ")}.` : "";
  const size = issue.field === "width" || issue.field === "height";
  let ask: string;
  if (issue.field === "room") ask = "Which room is this window in?";
  else if (size) ask = `What is the correct ${issue.field}? (e.g. 34 5/8)`;
  else if (issue.field === "control_side") ask = `Which side should the ${findProduct(supplier, v.sku)?.controlSideLabel.toLowerCase() ?? "control"} be, left or right?`;
  else ask = `Which ${FIELD_LABEL[issue.field]} should this line use?`;
  if (attempt > 1) return `${head}: I couldn't match that answer to a valid ${FIELD_LABEL[issue.field]}. ${size ? "Please reply with just the measurement in inches, e.g. 34 5/8." : `Please reply with one of these.${choice}`}`;
  return `${head}: ${issue.message} ${ask}${choice}`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Deterministic answer matching: exact code, exact label, or a code/label word inside the reply.
 * Returns null when it isn't a clean single match (the model interpreter is the next step).
 */
export function matchAnswerDeterministic(supplier: Supplier, v: LineValues, field: LineField, answer: string): string | number | null {
  const a = answer.trim();
  if (!a) return null;
  if (field === "room") return a.replace(/\s+/g, " ").slice(0, 60);
  if (field === "width" || field === "height") {
    const m = a.match(/\d{1,3}(?:\s*[- ]\s*\d{1,2}\s*\/\s*\d{1,2}|\.\d{1,4}|[½¼¾⅛⅜⅝⅞])?(?!\s*\/)/);
    if (!m) return null;
    const r = parseInches(m[0]);
    return r.ok ? r.value : null;
  }
  const opts = optionsFor(supplier, v, field);
  const na = norm(a);
  const exact = opts.filter((o) => norm(o.value) === na || norm(o.label) === na);
  if (exact.length === 1) return exact[0].value;
  const hits = opts.filter((o) => {
    const words = ` ${na} `;
    const nameOnly = norm(o.label.replace(o.value, ""));
    return words.includes(` ${norm(o.value)} `) || (nameOnly.length > 2 && words.includes(` ${nameOnly} `));
  });
  if (hits.length === 1) return hits[0].value;
  // supplier abbreviations (e.g. "INS", "RH")
  const aliasMap: Record<string, Record<string, string[] | undefined>> = {
    mount: supplier.aliases.mount,
    lift: supplier.aliases.lift,
    control_side: supplier.aliases.side,
    valance: supplier.aliases.valance,
  };
  const table = aliasMap[field];
  if (table) {
    const words = ` ${na} `;
    const ali = Object.entries(table).filter(([value, al]) => opts.some((o) => o.value === value) && (al ?? []).concat(value.replace(/_/g, " ")).some((x) => words.includes(` ${norm(x)} `)));
    if (ali.length === 1) return ali[0][0];
  }
  return null;
}

export function describeValue(field: LineField, value: unknown) {
  if (value == null || value === "") return "—";
  if (field === "width" || field === "height") return formatInches(value as number);
  if (field === "mount") return LABELS.mount[value as keyof typeof LABELS.mount] ?? String(value);
  if (field === "lift") return LABELS.lift[value as keyof typeof LABELS.lift] ?? String(value);
  if (field === "control_side") return LABELS.side[value as keyof typeof LABELS.side] ?? String(value);
  if (field === "valance") return LABELS.valance[value as keyof typeof LABELS.valance] ?? String(value);
  if (field === "product_type") return LABELS.product_type[value as keyof typeof LABELS.product_type] ?? String(value);
  return String(value);
}
