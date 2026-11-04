// Fictional supplier catalogs. This single source drives BOTH the human-readable product
// reference docs (data/suppliers/*.md, generated) and the deterministic validator.
// No real manufacturer names, codes or documents.

export const PRODUCT_TYPES = ["roller_shade", "cellular_shade", "faux_wood_blind", "shutter", "drapery"] as const;
export const LIFTS = ["cordless", "continuous_loop", "motorized"] as const;
export const MOUNTS = ["inside", "outside"] as const;
export const SIDES = ["left", "right"] as const;
export const VALANCES = ["cassette", "fascia", "standard_valance", "crown_valance"] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];
export type Lift = (typeof LIFTS)[number];
export type Mount = (typeof MOUNTS)[number];
export type Side = (typeof SIDES)[number];
export type Valance = (typeof VALANCES)[number];

export interface SizeLimit {
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
}

export interface Fabric {
  code: string;
  name: string;
  colours: { code: string; name: string }[];
}

export interface Product {
  sku: string;
  name: string;
  type: ProductType;
  fabricLabel: string; // "Fabric", "Slat finish", "Material"
  fabrics: Fabric[];
  /** size limits per lift system; shutters have no lift and use `fixed` */
  lifts: Partial<Record<Lift, SizeLimit>>;
  fixed?: SizeLimit;
  mounts: Mount[];
  /** lifts that require a control side ("always" = every lift, e.g. tilt wand / draw side) */
  controlSideFor: (Lift | "always")[];
  controlSideLabel: string;
  valances: Valance[];
  motors: string[];
}

export interface Motor {
  code: string;
  name: string;
  remotes: string[];
}

export interface Supplier {
  code: "NFS" | "BWB" | "LWF";
  name: string;
  address: string;
  phone: string;
  products: Product[];
  motors: Motor[];
  remotes: { code: string; name: string }[];
  /** how this supplier writes option values on invoices (also used as deterministic evidence aliases) */
  aliases: {
    mount: Record<Mount, string[]>;
    lift: Record<Lift, string[]>;
    side: Record<Side, string[]>;
    valance: Partial<Record<Valance, string[]>>;
  };
}

const L = (minW: number, maxW: number, minH: number, maxH: number): SizeLimit => ({ minW, maxW, minH, maxH });

export const SUPPLIERS: Supplier[] = [
  {
    code: "NFS",
    name: "Northfold Shade Co.",
    address: "1180 Larchmont Ave, Tacoma, WA 98402",
    phone: "(253) 555-0142",
    motors: [
      { code: "NM-20", name: "Northfold 20 rechargeable motor", remotes: ["NR-1", "NR-5"] },
      { code: "NM-35", name: "Northfold 35 hardwired motor", remotes: ["NR-5", "NH-HUB"] },
      { code: "ND-60", name: "Northfold 60 drapery track motor", remotes: ["NR-5", "NH-HUB"] },
    ],
    remotes: [
      { code: "NR-1", name: "1-channel handheld remote" },
      { code: "NR-5", name: "5-channel handheld remote" },
      { code: "NH-HUB", name: "Northfold home hub (app control)" },
    ],
    aliases: {
      mount: { inside: ["INS", "inside"], outside: ["OUT", "outside"] },
      lift: { cordless: ["CL", "cordless"], continuous_loop: ["CLP", "loop"], motorized: ["MTR", "motor", "motorized"] },
      side: { left: ["L", "left"], right: ["R", "right"] },
      valance: { cassette: ["CAS", "cassette"], fascia: ["FAS", "fascia"] },
    },
    products: [
      {
        sku: "NF-RS-210",
        name: "Solace Light-Filtering Roller",
        type: "roller_shade",
        fabricLabel: "Fabric",
        fabrics: [
          { code: "SOL-L", name: "Solace Linen", colours: [{ code: "L01", name: "Chalk" }, { code: "L02", name: "Oat" }, { code: "L03", name: "Slate" }] },
          { code: "SOL-W", name: "Solace Weave", colours: [{ code: "W11", name: "Snow" }, { code: "W12", name: "Flax" }, { code: "W14", name: "Graphite" }] },
        ],
        lifts: { cordless: L(12, 72, 12, 96), continuous_loop: L(12, 120, 12, 120), motorized: L(22, 120, 12, 120) },
        mounts: ["inside", "outside"],
        controlSideFor: ["continuous_loop", "motorized"],
        controlSideLabel: "Control side",
        valances: ["cassette", "fascia"],
        motors: ["NM-20", "NM-35"],
      },
      {
        sku: "NF-RS-240",
        name: "Meridian Blackout Roller",
        type: "roller_shade",
        fabricLabel: "Fabric",
        fabrics: [{ code: "MER-B", name: "Meridian Blackout", colours: [{ code: "B21", name: "Snow" }, { code: "B22", name: "Charcoal" }, { code: "B23", name: "Sand" }] }],
        lifts: { cordless: L(14, 72, 14, 96), continuous_loop: L(14, 120, 14, 120), motorized: L(24, 120, 14, 120) },
        mounts: ["inside", "outside"],
        controlSideFor: ["continuous_loop", "motorized"],
        controlSideLabel: "Control side",
        valances: ["cassette", "fascia"],
        motors: ["NM-20", "NM-35"],
      },
      {
        sku: "NF-CS-310",
        name: 'Hollowell 3/8" Cellular',
        type: "cellular_shade",
        fabricLabel: "Fabric",
        fabrics: [
          { code: "HOL-LF", name: "Hollowell Light-Filtering", colours: [{ code: "C31", name: "White Dove" }, { code: "C32", name: "Pebble" }, { code: "C33", name: "Driftwood" }] },
          { code: "HOL-BO", name: "Hollowell Blackout", colours: [{ code: "C41", name: "White Dove" }, { code: "C42", name: "Ash" }] },
        ],
        lifts: { cordless: L(10, 84, 12, 84), motorized: L(20, 96, 12, 96) },
        mounts: ["inside", "outside"],
        controlSideFor: ["motorized"],
        controlSideLabel: "Motor side",
        valances: [],
        motors: ["NM-20"],
      },
      {
        sku: "NF-DR-510",
        name: "Arbor Pinch-Pleat Drapery",
        type: "drapery",
        fabricLabel: "Fabric",
        fabrics: [{ code: "ARB", name: "Arbor Linen Blend", colours: [{ code: "D51", name: "Ivory" }, { code: "D52", name: "Fog" }, { code: "D53", name: "Midnight" }] }],
        lifts: { continuous_loop: L(24, 144, 36, 108), motorized: L(30, 144, 36, 108) },
        mounts: ["outside"],
        controlSideFor: ["always"],
        controlSideLabel: "Draw / cord side",
        valances: [],
        motors: ["ND-60"],
      },
    ],
  },
  {
    code: "BWB",
    name: "Bramblewood Blind & Shutter",
    address: "42 Foundry Row, Asheville, NC 28801",
    phone: "(828) 555-0177",
    motors: [{ code: "BM-1", name: "Bramblewood Glide tilt/lift motor", remotes: ["BR-1", "BR-6"] }],
    remotes: [
      { code: "BR-1", name: "1-channel remote" },
      { code: "BR-6", name: "6-channel remote" },
    ],
    aliases: {
      mount: { inside: ["IM", "inside"], outside: ["OM", "outside"] },
      lift: { cordless: ["CRDLS", "cordless"], continuous_loop: ["CONT LOOP", "loop"], motorized: ["PWR", "motor", "motorized"] },
      side: { left: ["LH", "left"], right: ["RH", "right"] },
      valance: { standard_valance: ["STD VAL", "standard valance"], crown_valance: ["CRN VAL", "crown"] },
    },
    products: [
      {
        sku: "BW-FW2",
        name: 'Heritage 2" Faux Wood Blind',
        type: "faux_wood_blind",
        fabricLabel: "Slat finish",
        fabrics: [
          { code: "SM", name: "Smooth", colours: [{ code: "101", name: "Bright White" }, { code: "102", name: "Linen White" }, { code: "105", name: "Espresso" }] },
          { code: "EM", name: "Embossed", colours: [{ code: "201", name: "Bright White" }, { code: "203", name: "Driftwood" }] },
        ],
        lifts: { cordless: L(12, 72, 12, 84), motorized: L(24, 72, 12, 84) },
        mounts: ["inside", "outside"],
        controlSideFor: ["always"],
        controlSideLabel: "Tilt side",
        valances: ["standard_valance", "crown_valance"],
        motors: ["BM-1"],
      },
      {
        sku: "BW-FW25",
        name: 'Heritage 2-1/2" Faux Wood Blind',
        type: "faux_wood_blind",
        fabricLabel: "Slat finish",
        fabrics: [{ code: "SM", name: "Smooth", colours: [{ code: "101", name: "Bright White" }, { code: "102", name: "Linen White" }, { code: "105", name: "Espresso" }] }],
        lifts: { cordless: L(14, 72, 14, 84), motorized: L(24, 72, 14, 84) },
        mounts: ["inside", "outside"],
        controlSideFor: ["always"],
        controlSideLabel: "Tilt side",
        valances: ["standard_valance", "crown_valance"],
        motors: ["BM-1"],
      },
      {
        sku: "BW-SH35",
        name: 'Carriage 3-1/2" Louver Shutter',
        type: "shutter",
        fabricLabel: "Material",
        fabrics: [
          { code: "PV", name: "Polymer", colours: [{ code: "301", name: "Pure White" }, { code: "302", name: "Bisque" }] },
          { code: "BS", name: "Basswood", colours: [{ code: "401", name: "Pure White" }, { code: "404", name: "Walnut Stain" }] },
        ],
        lifts: {},
        fixed: L(12, 48, 12, 96),
        mounts: ["inside", "outside"],
        controlSideFor: [],
        controlSideLabel: "Hinge side",
        valances: [],
        motors: [],
      },
      {
        sku: "BW-SH45",
        name: 'Carriage 4-1/2" Louver Shutter',
        type: "shutter",
        fabricLabel: "Material",
        fabrics: [{ code: "PV", name: "Polymer", colours: [{ code: "301", name: "Pure White" }, { code: "302", name: "Bisque" }] }],
        lifts: {},
        fixed: L(18, 48, 18, 96),
        mounts: ["inside", "outside"],
        controlSideFor: [],
        controlSideLabel: "Hinge side",
        valances: [],
        motors: [],
      },
    ],
  },
  {
    code: "LWF",
    name: "Lumaris Window Fashions",
    address: "900 Canal Street, Suite 4, Providence, RI 02903",
    phone: "(401) 555-0119",
    motors: [
      { code: "LM-Q", name: "Lumaris Quiet shade motor", remotes: ["LR-1", "LR-15"] },
      { code: "LM-T", name: "Lumaris drapery track motor", remotes: ["LR-15", "LH-BRIDGE"] },
    ],
    remotes: [
      { code: "LR-1", name: "1-channel remote" },
      { code: "LR-15", name: "15-channel remote" },
      { code: "LH-BRIDGE", name: "Lumaris bridge (app + voice)" },
    ],
    aliases: {
      mount: { inside: ["Inside Mount", "inside"], outside: ["Outside Mount", "outside"] },
      lift: { cordless: ["Cordless"], continuous_loop: ["Continuous Loop", "loop"], motorized: ["Motorized", "motor"] },
      side: { left: ["Left"], right: ["Right"] },
      valance: { cassette: ["Cassette"], fascia: ["Fascia"] },
    },
    products: [
      {
        sku: "LUM-ROL-50",
        name: "Aura Roller Shade",
        type: "roller_shade",
        fabricLabel: "Fabric",
        fabrics: [
          { code: "AUR-SH", name: "Aura Sheer 5%", colours: [{ code: "5-WHT", name: "White" }, { code: "5-GRY", name: "Grey" }, { code: "5-BRZ", name: "Bronze" }] },
          { code: "AUR-BO", name: "Aura Blackout", colours: [{ code: "K-WHT", name: "White" }, { code: "K-BLK", name: "Black" }] },
        ],
        lifts: { cordless: L(12, 84, 12, 108), continuous_loop: L(12, 144, 12, 144), motorized: L(20, 144, 12, 144) },
        mounts: ["inside", "outside"],
        controlSideFor: ["continuous_loop", "motorized"],
        controlSideLabel: "Control side",
        valances: ["cassette", "fascia"],
        motors: ["LM-Q"],
      },
      {
        sku: "LUM-CEL-34",
        name: 'Nimbus 3/4" Single Cell',
        type: "cellular_shade",
        fabricLabel: "Fabric",
        fabrics: [{ code: "NIM", name: "Nimbus Light-Filtering", colours: [{ code: "N-100", name: "Cloud" }, { code: "N-140", name: "Linen" }, { code: "N-180", name: "Smoke" }] }],
        lifts: { cordless: L(12, 96, 12, 96), continuous_loop: L(18, 120, 18, 120), motorized: L(18, 120, 12, 120) },
        mounts: ["inside", "outside"],
        controlSideFor: ["continuous_loop", "motorized"],
        controlSideLabel: "Control side",
        valances: [],
        motors: ["LM-Q"],
      },
      {
        sku: "LUM-FW-2",
        name: 'Cedarline 2" Faux Wood Blind',
        type: "faux_wood_blind",
        fabricLabel: "Slat finish",
        fabrics: [{ code: "CDL-SM", name: "Cedarline Smooth", colours: [{ code: "W-01", name: "White" }, { code: "W-04", name: "Cream" }, { code: "W-09", name: "Grey Oak" }] }],
        lifts: { cordless: L(12, 78, 12, 84) },
        mounts: ["inside", "outside"],
        controlSideFor: ["always"],
        controlSideLabel: "Tilt side",
        valances: [],
        motors: [],
      },
      {
        sku: "LUM-DRP-RP",
        name: "Tessa Ripplefold Drapery",
        type: "drapery",
        fabricLabel: "Fabric",
        fabrics: [{ code: "TES", name: "Tessa Woven", colours: [{ code: "T-IVY", name: "Ivory" }, { code: "T-SAG", name: "Sage" }, { code: "T-CHR", name: "Charcoal" }] }],
        lifts: { cordless: L(24, 180, 36, 120), motorized: L(36, 180, 36, 120) },
        mounts: ["outside"],
        controlSideFor: ["always"],
        controlSideLabel: "Stack / draw side",
        valances: [],
        motors: ["LM-T"],
      },
      {
        sku: "LUM-SHT-35",
        name: 'Vista 3-1/2" Poly Shutter',
        type: "shutter",
        fabricLabel: "Material",
        fabrics: [{ code: "PLY", name: "Vista Poly", colours: [{ code: "S-WHT", name: "White" }, { code: "S-ALB", name: "Alabaster" }] }],
        lifts: {},
        fixed: L(12, 42, 12, 96),
        mounts: ["inside", "outside"],
        controlSideFor: [],
        controlSideLabel: "Hinge side",
        valances: [],
        motors: [],
      },
    ],
  },
];

export function supplierByCode(code: string | null | undefined) {
  return SUPPLIERS.find((s) => s.code === code) ?? null;
}

/** Deterministic supplier detection: the supplier's legal name printed on the invoice. */
export function detectSupplier(text: string): Supplier | null {
  const norm = text.toLowerCase().replace(/\s+/g, " ");
  const hits = SUPPLIERS.filter((s) => norm.includes(s.name.toLowerCase()) || norm.includes(s.name.toLowerCase().replace(/[.&]/g, "").replace(/\s+/g, " ")));
  return hits.length === 1 ? hits[0] : null;
}

export function findProduct(supplier: Supplier, sku: string | null | undefined) {
  if (!sku) return null;
  const s = sku.trim().toUpperCase();
  return supplier.products.find((p) => p.sku === s) ?? null;
}

export function controlSideRequired(p: Product, lift: Lift | null) {
  if (p.controlSideFor.includes("always")) return true;
  return lift != null && p.controlSideFor.includes(lift);
}

export const LABELS = {
  product_type: { roller_shade: "Roller shade", cellular_shade: "Cellular shade", faux_wood_blind: "Faux wood blind", shutter: "Shutter", drapery: "Drapery" } as Record<ProductType, string>,
  lift: { cordless: "Cordless", continuous_loop: "Continuous loop", motorized: "Motorized" } as Record<Lift, string>,
  mount: { inside: "Inside mount", outside: "Outside mount" } as Record<Mount, string>,
  side: { left: "Left", right: "Right" } as Record<Side, string>,
  valance: { cassette: "Cassette valance", fascia: "Fascia", standard_valance: "Standard valance", crown_valance: "Crown valance" } as Record<Valance, string>,
};
