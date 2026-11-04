// Generates the fictional dataset: supplier product reference docs, 25 supplier invoices (PDF,
// several layouts, 2 scans), a ground-truth JSON per invoice, and the customer list.
// Deterministic (seeded) so the dataset is reproducible.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { LABELS, SUPPLIERS, controlSideRequired, type Lift, type Product, type Supplier } from "../src/lib/catalog.ts";
import { formatInches } from "../src/lib/fractions.ts";
import type { LineValues } from "../src/lib/worker/types.ts";

const root = new URL("..", import.meta.url).pathname;
const out = (p: string) => root + p;
for (const d of ["data/suppliers", "data/ground-truth", "public/samples", "public/docs"]) mkdirSync(out(d), { recursive: true });

// ---------- seeded RNG ----------
let seed = 20261104;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const eighths = (min: number, max: number) => Math.round((min + rnd() * (max - min)) * 8) / 8;

export const BUSINESS = { name: "Harbor & Pine Window Studio", address: "77 Wharf Lane, Mystic, CT 06355" };

// ---------- customers ----------
export const CUSTOMERS = [
  ["Adaeze Okafor", "J-2201"], ["Tomás Herrera", "J-2202"], ["Mei-Lin Chau", "J-2203"], ["Graham Whitlock", "J-2204"],
  ["Priya Patel", "J-2205"], ["Samuel Osei", "J-2206"], ["Ingrid Halvorsen", "J-2207"], ["Dario Benedetti", "J-2208"],
  ["Rosa Quintero", "J-2209"], ["Arjun Patel", "J-2210"], ["Colette Marchand", "J-2211"], ["Hiroshi Tanabe", "J-2212"],
  ["Nora Fitzgerald", "J-2213"], ["Kwame Mensah", "J-2214"], ["Elena Volkova", "J-2215"], ["Marcus Bell", "J-2216"],
  ["Yasmin Haddad", "J-2217"], ["Owen Lindqvist", "J-2218"], ["Beatriz Lopes", "J-2219"], ["Felix Achterberg", "J-2220"],
].map(([name, job]) => ({ name, job_no: job }));
writeFileSync(out("data/customers.json"), JSON.stringify(CUSTOMERS, null, 2) + "\n");

// ---------- supplier reference docs ----------
function supplierDoc(s: Supplier) {
  const lines: string[] = [];
  lines.push(`# ${s.name} — Product Reference (dealer edition)`, "", `${s.address} · ${s.phone}`, "", "_Fictional supplier created for a demo. Not a real manufacturer._", "");
  lines.push("## How we write options on invoices", "");
  lines.push("| Option | Value | Printed on invoice as |", "|---|---|---|");
  for (const [k, map] of Object.entries(s.aliases)) {
    for (const [val, al] of Object.entries(map as Record<string, string[]>)) {
      const label = (LABELS as Record<string, Record<string, string>>)[k === "side" ? "side" : k]?.[val] ?? val;
      lines.push(`| ${k === "side" ? "control side" : k} | ${label} (\`${val}\`) | ${al.map((a) => `\`${a}\``).join(", ")} |`);
    }
  }
  lines.push("", "Sizes are width × height in inches, to the nearest 1/8\". Every line is one window (qty 1).", "");
  lines.push("## Motors and remotes", "", "| Motor | Description | Compatible remotes |", "|---|---|---|");
  for (const m of s.motors) lines.push(`| ${m.code} | ${m.name} | ${m.remotes.join(", ")} |`);
  lines.push("", "| Remote | Description |", "|---|---|");
  for (const r of s.remotes) lines.push(`| ${r.code} | ${r.name} |`);
  lines.push("", "Motorized lines must specify a motor and a compatible remote or hub.", "");
  lines.push("## Product lines", "");
  for (const p of s.products) {
    lines.push(`### ${p.sku} — ${p.name}`, "", `Type: ${LABELS.product_type[p.type]}`, "");
    lines.push(`- Mount: ${p.mounts.map((m) => LABELS.mount[m]).join(", ")}${p.mounts.length === 1 ? " **only**" : ""}`);
    if (p.type === "shutter") lines.push(`- Lift system: none (hinged panels). Size: width ${formatInches(p.fixed!.minW)}–${formatInches(p.fixed!.maxW)}, height ${formatInches(p.fixed!.minH)}–${formatInches(p.fixed!.maxH)}`);
    else {
      lines.push("- Lift systems and size limits:", "", "  | Lift | Min W | Max W | Min H | Max H |", "  |---|---|---|---|---|");
      for (const [l, lim] of Object.entries(p.lifts)) lines.push(`  | ${LABELS.lift[l as Lift]} | ${formatInches(lim!.minW)} | ${formatInches(lim!.maxW)} | ${formatInches(lim!.minH)} | ${formatInches(lim!.maxH)} |`);
      const notOffered = (["cordless", "continuous_loop", "motorized"] as Lift[]).filter((l) => !p.lifts[l]);
      if (notOffered.length) lines.push("", `  Not offered: ${notOffered.map((l) => LABELS.lift[l]).join(", ")}.`);
    }
    const cs = p.controlSideFor.includes("always") ? "required on every order" : p.controlSideFor.length ? `required for ${p.controlSideFor.map((l) => LABELS.lift[l as Lift].toLowerCase()).join(" and ")}` : "not applicable";
    lines.push(`- ${p.controlSideLabel} (left/right): ${cs}`);
    lines.push(`- Valance: ${p.valances.length ? p.valances.map((v) => LABELS.valance[v]).join(", ") + " (optional)" : "not offered"}`);
    if (p.motors.length) lines.push(`- Motors: ${p.motors.join(", ")}`);
    lines.push(`- ${p.fabricLabel}s and colours:`);
    for (const f of p.fabrics) lines.push(`  - \`${f.code}\` ${f.name}: ${f.colours.map((c) => `\`${c.code}\` ${c.name}`).join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}
for (const s of SUPPLIERS) {
  const md = supplierDoc(s);
  writeFileSync(out(`data/suppliers/${s.code}.md`), md);
  writeFileSync(out(`public/docs/${s.code}.md`), md);
}

// ---------- invoice scenarios ----------
type Defect =
  | { kind: "missing"; field: keyof LineValues; answer: string }
  | { kind: "invalid"; field: keyof LineValues; printed: string | number; answer: string; final: string | number }
  | { kind: "ambiguous_colour"; answers: { fabric: string; colour: string } };

interface Line {
  line_no: number;
  product: Product;
  final: LineValues;
  printed: LineValues; // what the invoice shows (null = not shown / not determinable)
  price: number;
  defect?: Defect;
}

const ROOMS = ["Living Room", "Kitchen", "Primary Bedroom", "Bedroom 2", "Bedroom 3", "Office", "Dining Room", "Family Room", "Nursery", "Primary Bath", "Den", "Sunroom", "Mudroom", "Guest Room", "Laundry"];

function makeLine(s: Supplier, lineNo: number, usedRooms: Set<string>, opts: { sku?: string; lift?: Lift } = {}): Line {
  const product = opts.sku ? s.products.find((p) => p.sku === opts.sku)! : pick(s.products);
  let room = pick(ROOMS);
  while (usedRooms.has(room)) room = pick(ROOMS);
  usedRooms.add(room);
  const lifts = Object.keys(product.lifts) as Lift[];
  const lift = product.type === "shutter" ? null : opts.lift ?? pick(lifts);
  const lim = product.type === "shutter" ? product.fixed! : product.lifts[lift!]!;
  const width = eighths(Math.max(lim.minW, 20), Math.min(lim.maxW, 84));
  const height = eighths(Math.max(lim.minH, 30), Math.min(lim.maxH, 96));
  const fabric = pick(product.fabrics);
  const colour = pick(fabric.colours);
  const needSide = controlSideRequired(product, lift);
  const motor = lift === "motorized" ? pick(product.motors) : null;
  const remote = motor ? pick(s.motors.find((m) => m.code === motor)!.remotes) : null;
  const final: LineValues = {
    room,
    product_type: product.type,
    sku: product.sku,
    width,
    height,
    mount: pick(product.mounts),
    lift,
    control_side: needSide ? pick(["left", "right"] as const) : null,
    fabric_code: fabric.code,
    colour_code: colour.code,
    valance: product.valances.length && rnd() < 0.4 ? pick(product.valances) : null,
    motor_code: motor,
    remote_code: remote,
  };
  const base = { roller_shade: 210, cellular_shade: 260, faux_wood_blind: 150, shutter: 520, drapery: 640 }[product.type];
  const price = Math.round((base + (width * height) / 20 + (motor ? 340 : 0)) * 100) / 100;
  return { line_no: lineNo, product, final, printed: { ...final }, price };
}

interface Scenario {
  n: number;
  supplier: Supplier["code"];
  layout: "A" | "B";
  scanned?: boolean;
  duplicateOf?: number;
  customer: number; // index into CUSTOMERS
  lines: number;
  setup?: (lines: Line[], s: Supplier, rooms: Set<string>) => void;
}

const defect = (l: Line, d: Defect) => {
  l.defect = d;
  if (d.kind === "missing") (l.printed as unknown as Record<string, unknown>)[d.field] = null;
  if (d.kind === "invalid") {
    (l.printed as unknown as Record<string, unknown>)[d.field] = d.printed;
    (l.final as unknown as Record<string, unknown>)[d.field] = d.final;
  }
  if (d.kind === "ambiguous_colour") {
    l.printed.fabric_code = null;
    l.printed.colour_code = null;
  }
};
const replaceLine = (lines: Line[], i: number, s: Supplier, rooms: Set<string>, o: { sku?: string; lift?: Lift }) => {
  rooms.delete(lines[i].final.room!);
  lines[i] = makeLine(s, i + 1, rooms, o);
  return lines[i];
};

const SCENARIOS: Scenario[] = [
  { n: 1, supplier: "NFS", layout: "A", customer: 0, lines: 4 },
  { n: 2, supplier: "BWB", layout: "A", customer: 1, lines: 3, setup: (ls, s, r) => {
    const l = replaceLine(ls, 1, s, r, { sku: "BW-FW2", lift: "cordless" });
    defect(l, { kind: "missing", field: "control_side", answer: `${l.final.control_side} hand tilt` });
  } },
  { n: 3, supplier: "LWF", layout: "A", customer: 2, lines: 4, setup: (ls) => defect(ls[2], { kind: "missing", field: "mount", answer: `${ls[2].final.mount} mount please` }) },
  { n: 4, supplier: "NFS", layout: "A", customer: 3, lines: 3, setup: (ls, s, r) => {
    const l = replaceLine(ls, 0, s, r, { sku: "NF-CS-310", lift: "cordless" });
    l.final.width = l.printed.width = 30.5;
    defect(l, { kind: "invalid", field: "lift", printed: "continuous_loop", final: "cordless", answer: "Make it cordless" });
    l.printed.control_side = "right";
    l.final.control_side = "right";
  } },
  { n: 5, supplier: "BWB", layout: "A", customer: 4, lines: 3, setup: (ls, s, r) => {
    const l = replaceLine(ls, 2, s, r, { sku: "BW-FW2", lift: "cordless" });
    l.final.fabric_code = "EM";
    l.printed.fabric_code = "EM";
    defect(l, { kind: "invalid", field: "colour_code", printed: "105", final: "203", answer: "203 Driftwood" });
  } },
  { n: 6, supplier: "LWF", layout: "A", customer: 5, lines: 3, setup: (ls, s, r) => {
    const l = replaceLine(ls, 0, s, r, { sku: "LUM-ROL-50", lift: "motorized" });
    defect(l, { kind: "missing", field: "remote_code", answer: `${l.final.remote_code}` });
  } },
  { n: 7, supplier: "NFS", layout: "A", customer: 6, lines: 4, setup: (ls) => defect(ls[3], { kind: "missing", field: "room", answer: ls[3].final.room! }) },
  { n: 8, supplier: "BWB", layout: "A", customer: 7, lines: 3, setup: (ls, s, r) => {
    const l = replaceLine(ls, 1, s, r, { sku: "BW-SH35" });
    defect(l, { kind: "invalid", field: "width", printed: 52.25, final: 42.25, answer: "Typo on their end, it's 42 1/4" });
  } },
  { n: 9, supplier: "LWF", layout: "B", customer: 8, lines: 3 },
  { n: 10, supplier: "NFS", layout: "A", customer: 9, lines: 3, setup: (ls, s, r) => {
    const l = replaceLine(ls, 1, s, r, { sku: "NF-RS-240", lift: "motorized" });
    l.final.motor_code = "NM-35";
    l.printed.motor_code = "NM-35";
    defect(l, { kind: "invalid", field: "remote_code", printed: "NR-1", final: "NR-5", answer: "Use the 5-channel, NR-5" });
  } },
  { n: 11, supplier: "BWB", layout: "B", customer: 10, lines: 4, setup: (ls, s, r) => {
    const l = replaceLine(ls, 0, s, r, { sku: "BW-FW25", lift: "cordless" });
    l.final.fabric_code = "SM";
    l.printed.fabric_code = "SM";
    l.final.colour_code = "102";
    defect(l, { kind: "missing", field: "colour_code", answer: "Linen White" });
  } },
  { n: 12, supplier: "LWF", layout: "A", scanned: true, customer: 11, lines: 3 },
  { n: 13, supplier: "NFS", layout: "B", customer: 12, lines: 3, setup: (ls, s, r) => {
    const l = replaceLine(ls, 2, s, r, { sku: "NF-DR-510", lift: "continuous_loop" });
    defect(l, { kind: "invalid", field: "mount", printed: "inside", final: "outside", answer: "outside mount, above the casing" });
  } },
  { n: 14, supplier: "BWB", layout: "B", customer: 13, lines: 5 },
  { n: 15, supplier: "LWF", layout: "B", customer: 14, lines: 3, setup: (ls, s, r) => {
    const l = replaceLine(ls, 1, s, r, { sku: "LUM-ROL-50", lift: "cordless" });
    l.final.fabric_code = "AUR-BO";
    l.final.colour_code = "K-WHT";
    defect(l, { kind: "ambiguous_colour", answers: { fabric: "the blackout one", colour: "white" } });
  } },
  { n: 16, supplier: "NFS", layout: "B", customer: 15, lines: 3, setup: (ls, s, r) => {
    const l = replaceLine(ls, 0, s, r, { sku: "NF-RS-210", lift: "motorized" });
    l.final.motor_code = "NM-20";
    l.final.remote_code = "NR-1";
    l.printed.remote_code = "NR-1";
    defect(l, { kind: "missing", field: "motor_code", answer: "NM-20 battery motor" });
  } },
  { n: 17, supplier: "BWB", layout: "A", customer: 16, lines: 4 },
  { n: 18, supplier: "LWF", layout: "A", customer: 17, lines: 4, setup: (ls, s, r) => {
    const l = replaceLine(ls, 3, s, r, { sku: "LUM-CEL-34", lift: "continuous_loop" });
    defect(l, { kind: "missing", field: "control_side", answer: l.final.control_side === "left" ? "left side" : "right side" });
  } },
  { n: 19, supplier: "NFS", layout: "A", customer: 18, lines: 3, setup: (ls, s, r) => {
    const l = replaceLine(ls, 1, s, r, { sku: "NF-CS-310", lift: "cordless" });
    l.final.fabric_code = "HOL-LF";
    l.final.colour_code = "C31";
    defect(l, { kind: "ambiguous_colour", answers: { fabric: "light filtering", colour: "White Dove" } });
  } },
  { n: 20, supplier: "BWB", layout: "A", scanned: true, customer: 19, lines: 3 },
  { n: 21, supplier: "LWF", layout: "B", customer: 4, lines: 2 },
  { n: 22, supplier: "NFS", layout: "B", customer: 9, lines: 4 },
  { n: 23, supplier: "BWB", layout: "B", customer: 0, lines: 3, setup: (ls) => defect(ls[1], { kind: "missing", field: "height", answer: `${formatInches(ls[1].final.height).replace('"', "")} tall` }) },
  { n: 24, supplier: "LWF", layout: "A", customer: 7, lines: 3 },
  { n: 25, supplier: "LWF", layout: "B", customer: 8, lines: 3, duplicateOf: 9 },
];

const INV_PREFIX = { NFS: "NF-", BWB: "BWB/", LWF: "LWF-INV-" } as const;

interface Invoice {
  sc: Scenario;
  supplier: Supplier;
  invoiceNo: string;
  date: string;
  po: string;
  customer: (typeof CUSTOMERS)[number];
  lines: Line[];
}

const invoices = new Map<number, Invoice>();
for (const sc of SCENARIOS) {
  if (sc.duplicateOf) {
    invoices.set(sc.n, { ...invoices.get(sc.duplicateOf)!, sc });
    continue;
  }
  const s = SUPPLIERS.find((x) => x.code === sc.supplier)!;
  const rooms = new Set<string>();
  const lines = Array.from({ length: sc.lines }, (_, i) => makeLine(s, i + 1, rooms));
  sc.setup?.(lines, s, rooms);
  const day = 3 + sc.n;
  invoices.set(sc.n, {
    sc,
    supplier: s,
    invoiceNo: `${INV_PREFIX[s.code]}${s.code === "BWB" ? 8800 + sc.n * 7 : s.code === "NFS" ? 24100 + sc.n * 3 : 30500 + sc.n * 11}`,
    date: `2026-10-${String(day).padStart(2, "0")}`,
    po: `HP-${1040 + sc.n}`,
    customer: CUSTOMERS[sc.customer],
    lines,
  });
}

// ---------- rendering ----------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const lastName = (n: string) => n.split(" ").slice(-1)[0].toUpperCase();
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const UNI: Record<number, string> = { 0.125: "⅛", 0.25: "¼", 0.375: "⅜", 0.5: "½", 0.625: "⅝", 0.75: "¾", 0.875: "⅞" };
const sizeText = (v: number | null, style: "space" | "hyphen" | "unicode" | "decimal") => {
  if (v == null) return "";
  const whole = Math.floor(v);
  const f = v - whole;
  if (style === "decimal") return v.toFixed(3);
  if (!f) return String(whole);
  if (style === "unicode") return `${whole}${UNI[f]}`;
  const t = formatInches(v).replace('"', "").split(" ")[1];
  return style === "hyphen" ? `${whole}-${t}` : `${whole} ${t}`;
};
const al = (s: Supplier, kind: "mount" | "lift" | "side" | "valance", v: string | null) => (v ? (s.aliases[kind] as Record<string, string[]>)[v]?.[0] ?? v : "");
const colourName = (s: Supplier, sku: string, code: string | null) => s.products.find((p) => p.sku === sku)!.fabrics.flatMap((f) => f.colours).find((c) => c.code === code)?.name ?? "";
const fabricName = (s: Supplier, sku: string, code: string | null) => s.products.find((p) => p.sku === sku)!.fabrics.find((f) => f.code === code)?.name ?? "";

function printedColour(inv: Invoice, l: Line) {
  // ambiguous colour defect: only the colour NAME is printed, no fabric, no code
  if (l.defect?.kind === "ambiguous_colour") return colourName(inv.supplier, l.product.sku, l.final.colour_code);
  return l.printed.colour_code ?? "";
}

const CSS = `
*{box-sizing:border-box} body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#111;font-size:10.5px}
.page{width:8.5in;min-height:11in;padding:.55in .55in}
table{border-collapse:collapse;width:100%} th,td{padding:5px 5px;text-align:left;vertical-align:top}
.r{text-align:right} .muted{color:#555} h1{margin:0}
`;

function header(inv: Invoice, style: string) {
  const s = inv.supplier;
  const resent = inv.sc.duplicateOf ? `<div style="border:2px solid #b00;color:#b00;display:inline-block;padding:4px 10px;font-weight:bold;transform:rotate(-4deg);margin-top:6px">RE-SENT · COPY</div>` : "";
  return `<div style="display:flex;justify-content:space-between;${style}">
    <div><h1 style="font-size:20px">${esc(s.name)}</h1><div class="muted">${esc(s.address)}<br>${s.phone}</div></div>
    <div style="text-align:right"><div style="font-size:18px;font-weight:bold;letter-spacing:2px">INVOICE</div>
      <div>Invoice No: <b>${inv.invoiceNo}</b></div><div>Date: ${inv.date}</div><div>Dealer PO: ${inv.po}</div>${resent}</div></div>
    <div style="display:flex;gap:40px;margin:16px 0 14px">
      <div><div class="muted">BILL TO</div><b>${BUSINESS.name}</b><br>${BUSINESS.address}</div>
      <div><div class="muted">SIDEMARK</div><b>${lastName(inv.customer.name)} / ${inv.customer.job_no}</b></div>
      <div><div class="muted">TERMS</div>Net 30</div></div>`;
}

function totals(inv: Invoice) {
  const sub = inv.lines.reduce((a, l) => a + l.price, 0);
  const ship = 45;
  return `<table style="width:240px;margin-left:auto;margin-top:14px"><tr><td>Subtotal</td><td class="r">${money(sub)}</td></tr>
    <tr><td>Freight</td><td class="r">${money(ship)}</td></tr><tr><td><b>Total due</b></td><td class="r"><b>${money(sub + ship)}</b></td></tr></table>`;
}

function renderNFS(inv: Invoice) {
  const s = inv.supplier;
  if (inv.sc.layout === "A") {
    const rows = inv.lines.map((l) => {
      const p = l.printed;
      const extras = [p.valance ? `${al(s, "valance", p.valance)} VAL` : "", p.motor_code ? p.motor_code : "", p.remote_code ? `REM ${p.remote_code}` : ""].filter(Boolean).join("; ");
      const colour = printedColour(inv, l);
      return `<tr style="border-bottom:1px solid #ccc"><td>${l.line_no}</td><td>${esc(p.room ?? "")}</td><td>${l.product.sku}</td><td>${esc(l.product.name)}</td>
        <td>${p.fabric_code ?? ""}${colour ? ` / ${colour}` : ""}</td><td>${sizeText(p.width, "space")} x ${sizeText(p.height, "space")}</td>
        <td>${al(s, "mount", p.mount)}</td><td>${al(s, "lift", p.lift)}</td><td>${al(s, "side", p.control_side)}</td><td>${extras}</td><td class="r">1</td><td class="r">${money(l.price)}</td></tr>`;
    }).join("");
    return `<div class="page">${header(inv, "")}
      <table><thead><tr style="background:#1d3557;color:#fff"><th>LN</th><th>ROOM</th><th>SKU</th><th>DESCRIPTION</th><th>FAB / COL</th><th>SIZE W x H</th><th>MNT</th><th>LIFT</th><th>CTRL</th><th>OPTIONS</th><th class="r">QTY</th><th class="r">PRICE</th></tr></thead><tbody>${rows}</tbody></table>
      ${totals(inv)}<p class="muted" style="margin-top:24px">Abbrev: INS inside mount · OUT outside mount · CL cordless · CLP continuous loop · MTR motorized · CAS cassette · FAS fascia</p></div>`;
  }
  const blocks = inv.lines.map((l) => {
    const p = l.printed;
    const colour = printedColour(inv, l);
    const opt = [p.valance ? `${al(s, "valance", p.valance)} VAL` : "", p.motor_code ? `MOTOR ${p.motor_code}` : p.lift === "motorized" ? "MOTOR: ____" : "", p.remote_code ? `REMOTE ${p.remote_code}` : ""].filter(Boolean).join("  ");
    return `<div style="border-top:1px dashed #999;padding:8px 0;display:flex;justify-content:space-between"><div>
      <b>${String(l.line_no).padStart(2, "0")} &nbsp; ${esc((p.room ?? "ROOM: ______").toUpperCase())}</b> — ${l.product.sku} ${esc(l.product.name)}<br>
      ${p.fabric_code ?? ""}${colour ? ` / ${colour}` : ""} &nbsp; W ${sizeText(p.width, "space")}" &nbsp; H ${sizeText(p.height, "space")}" &nbsp; ${al(s, "mount", p.mount)} &nbsp; ${al(s, "lift", p.lift)} ${p.control_side ? `&nbsp; CTRL ${al(s, "side", p.control_side)}` : ""} ${opt ? `&nbsp; ${opt}` : ""}
      </div><div class="r">${money(l.price)}</div></div>`;
  }).join("");
  return `<div class="page" style="font-family:'Courier New',monospace">${header(inv, "")}<div style="font-weight:bold;margin-bottom:4px">SHIPPED ITEMS</div>${blocks}${totals(inv)}</div>`;
}

function renderBWB(inv: Invoice) {
  const s = inv.supplier;
  const style = inv.sc.layout === "A" ? "hyphen" : "unicode";
  const rows = inv.lines.map((l) => {
    const p = l.printed;
    const fin = p.fabric_code ? `${p.fabric_code} ${fabricName(s, l.product.sku, p.fabric_code)}` : "";
    const mr = p.lift === "motorized" ? `${p.motor_code ?? "?"} / ${p.remote_code ?? "?"}` : "";
    return `<tr style="border:1px solid #888"><td>${l.line_no}</td><td>${esc(p.room ?? "")}</td><td>${l.product.sku}<br><span class="muted">${esc(l.product.name)}</span></td><td>${fin}</td><td>${printedColour(inv, l)}</td>
      <td>${p.width == null ? "TBD" : sizeText(p.width, style)}</td><td>${p.height == null ? "TBD" : sizeText(p.height, style)}</td><td>${al(s, "mount", p.mount)}</td><td>${l.product.type === "shutter" ? "N/A" : al(s, "lift", p.lift)}</td>
      <td>${al(s, "side", p.control_side)}</td><td>${p.valance ? al(s, "valance", p.valance) : ""}</td><td>${mr}</td><td class="r">${money(l.price)}</td></tr>`;
  }).join("");
  return `<div class="page" style="font-family:Georgia,serif">${header(inv, "border-bottom:3px double #333;padding-bottom:10px")}
    <table style="font-size:10px"><thead><tr style="border:1px solid #888;background:#eee"><th>Item</th><th>Location</th><th>Style</th><th>Finish</th><th>Color</th><th>Width</th><th>Height</th><th>Mount</th><th>Lift</th><th>Tilt</th><th>Valance</th><th>Motor / Remote</th><th class="r">Ext.</th></tr></thead><tbody>${rows}</tbody></table>
    ${totals(inv)}<p class="muted">Sizes in inches, width before height. IM = inside mount, OM = outside mount, CRDLS = cordless, PWR = motorized, LH/RH = left/right hand.</p></div>`;
}

function renderLWF(inv: Invoice) {
  const s = inv.supplier;
  const decimal = inv.sc.layout === "B";
  const items = inv.lines.map((l) => {
    const p = l.printed;
    const parts: string[] = [];
    if (l.defect?.kind === "ambiguous_colour") parts.push(`colour ${printedColour(inv, l)}`);
    else if (p.fabric_code) parts.push(`${fabricName(s, l.product.sku, p.fabric_code)} (${p.fabric_code}) ${p.colour_code ?? ""} ${colourName(s, l.product.sku, p.colour_code)}`.trim());
    if (p.mount) parts.push(al(s, "mount", p.mount));
    if (p.lift) parts.push(al(s, "lift", p.lift));
    if (p.control_side) parts.push(`${al(s, "side", p.control_side)} Control`);
    if (p.valance) parts.push(`${al(s, "valance", p.valance)} valance`);
    if (p.motor_code) parts.push(`motor ${p.motor_code}`);
    if (p.remote_code) parts.push(`remote ${p.remote_code}`);
    const size = decimal ? `${sizeText(p.width, "decimal")} in W × ${sizeText(p.height, "decimal")} in H` : `${sizeText(p.width, "space")}" W x ${sizeText(p.height, "space")}" H`;
    return `<tr style="border-bottom:1px solid #ddd"><td style="width:24px">${l.line_no}.</td><td><b>${esc(p.room ?? "")}</b> — ${esc(l.product.name)} (${l.product.sku})<br>${esc(parts.join(", "))}.<br><span class="muted">Size: ${size}</span></td><td class="r">${money(l.price)}</td></tr>`;
  }).join("");
  return `<div class="page" style="font-family:'Trebuchet MS',sans-serif">${header(inv, "border-left:6px solid #7a4cc2;padding-left:12px")}
    <table><thead><tr style="border-bottom:2px solid #7a4cc2"><th>#</th><th>Item description</th><th class="r">Amount</th></tr></thead><tbody>${items}</tbody></table>${totals(inv)}
    <p class="muted">Thank you for your order. Lumaris measures in inches${decimal ? " (decimal)" : ""}, width × height.</p></div>`;
}

function invoiceHtml(inv: Invoice, scanned: boolean) {
  const body = inv.supplier.code === "NFS" ? renderNFS(inv) : inv.supplier.code === "BWB" ? renderBWB(inv) : renderLWF(inv);
  const scanCss = scanned ? `body{background:#f3f1ea} .page{transform:rotate(0.6deg);filter:grayscale(1) contrast(1.15) blur(0.35px)}` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}${scanCss}</style></head><body>${body}</body></html>`;
}

// ---------- ground truth ----------
function groundTruth(inv: Invoice, file: string) {
  return {
    file,
    invoice_number: inv.invoiceNo,
    supplier: inv.supplier.code,
    sidemark: `${lastName(inv.customer.name)} / ${inv.customer.job_no}`,
    customer_job: inv.customer.job_no,
    layout: `${inv.supplier.code}-${inv.sc.layout}`,
    scanned: !!inv.sc.scanned,
    duplicate_of: inv.sc.duplicateOf ? `INV-${String(inv.sc.duplicateOf).padStart(2, "0")}` : null,
    lines: inv.lines.map((l) => ({ line_no: l.line_no, final: l.final, printed: l.printed })),
    expected_issues: inv.sc.duplicateOf
      ? []
      : inv.lines.flatMap((l) => {
          const d = l.defect;
          if (!d) return [];
          if (d.kind === "ambiguous_colour") return [{ line_no: l.line_no, field: "fabric_code", kind: "missing" }, { line_no: l.line_no, field: "colour_code", kind: "ambiguous" }];
          return [{ line_no: l.line_no, field: d.field, kind: d.kind }];
        }),
    answers: inv.sc.duplicateOf
      ? []
      : inv.lines.flatMap((l) => {
          const d = l.defect;
          if (!d) return [];
          if (d.kind === "ambiguous_colour") return [{ line_no: l.line_no, field: "fabric_code", answer: d.answers.fabric }, { line_no: l.line_no, field: "colour_code", answer: d.answers.colour }];
          return [{ line_no: l.line_no, field: d.field, answer: d.answer }];
        }),
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
const index: { id: string; file: string; supplier: string; invoice_number: string; scanned: boolean; layout: string; note: string }[] = [];
for (const sc of SCENARIOS) {
  const inv = invoices.get(sc.n)!;
  const id = `INV-${String(sc.n).padStart(2, "0")}`;
  const file = `${id}.pdf`;
  await page.setContent(invoiceHtml(inv, !!sc.scanned), { waitUntil: "load" });
  let pdf: Uint8Array;
  if (sc.scanned) {
    const jpg = await page.screenshot({ type: "jpeg", quality: 72, fullPage: true });
    const doc = await PDFDocument.create();
    const img = await doc.embedJpg(jpg);
    const pg = doc.addPage([612, 792]);
    pg.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
    doc.setProducer("Office scanner");
    pdf = await doc.save();
  } else {
    pdf = await page.pdf({ format: "Letter", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
  }
  writeFileSync(out(`public/samples/${file}`), pdf);
  const gt = groundTruth(inv, file);
  writeFileSync(out(`data/ground-truth/${id}.json`), JSON.stringify(gt, null, 2) + "\n");
  const note = sc.duplicateOf
    ? `re-sent copy of INV-${String(sc.duplicateOf).padStart(2, "0")}`
    : gt.expected_issues.length
      ? gt.expected_issues.map((i) => `line ${i.line_no}: ${i.kind} ${i.field}`).join("; ")
      : "clean";
  index.push({ id, file, supplier: inv.supplier.name, invoice_number: inv.invoiceNo, scanned: !!sc.scanned, layout: gt.layout, note: (sc.scanned ? "scanned · " : "") + note });
}
await browser.close();
writeFileSync(out("data/samples.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`generated ${index.length} invoices`);
