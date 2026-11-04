// Deterministic inch parsing. The model copies the size text exactly as printed;
// this code (never the model) turns it into an exact number.

const VULGAR: Record<string, [number, number]> = {
  "½": [1, 2], "¼": [1, 4], "¾": [3, 4], "⅛": [1, 8], "⅜": [3, 8], "⅝": [5, 8], "⅞": [7, 8],
  "⅙": [1, 6], "⅓": [1, 3], "⅔": [2, 3], "⅕": [1, 5],
};
const ALLOWED_DEN = new Set([2, 4, 8, 16]);

export type ParseResult = { ok: true; value: number } | { ok: false; error: string };

/**
 * Parses a single inch measurement.
 * Accepts: `34 5/8`, `34-5/8`, `34 5/8"`, `34⅝`, `34.625`, `34`, `5/8`, `34 5/8 in`, `W 34 5/8`.
 * Rejects: non power-of-two denominators (5/7), improper fractions (9/8), empty, negative.
 */
export function parseInches(raw: string | null | undefined): ParseResult {
  if (raw == null) return { ok: false, error: "missing" };
  let s = String(raw).trim();
  if (!s) return { ok: false, error: "missing" };
  s = s.replace(/^[WH]\s*[:=]?\s*/i, "").replace(/(″|"|''|\bin(ch(es)?)?\.?)\s*$/i, "").trim();
  // unicode vulgar fractions → " n/d"
  for (const [ch, [n, d]] of Object.entries(VULGAR)) s = s.replace(ch, ` ${n}/${d}`);
  s = s.replace(/⁄/g, "/").replace(/\s+/g, " ").trim();

  let m = s.match(/^(\d{1,3})(?:\s*[- ]\s*|\s+)(\d{1,2})\s*\/\s*(\d{1,2})$/);
  if (m) return frac(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
  if (m) return frac(0, Number(m[1]), Number(m[2]));
  m = s.match(/^(\d{1,3})(?:\.(\d{1,4}))?$/);
  if (m) {
    const v = Number(s);
    return v > 0 ? { ok: true, value: v } : { ok: false, error: "must be positive" };
  }
  return { ok: false, error: `unreadable measurement "${raw}"` };
}

function frac(whole: number, n: number, d: number): ParseResult {
  if (!ALLOWED_DEN.has(d)) return { ok: false, error: `unusual fraction ${n}/${d} (expected halves to sixteenths)` };
  if (n <= 0 || n >= d) return { ok: false, error: `improper fraction ${n}/${d}` };
  const v = whole + n / d; // exact in binary floating point for power-of-two denominators
  return v > 0 ? { ok: true, value: v } : { ok: false, error: "must be positive" };
}

/** Splits a combined size like `34 5/8 x 60 1/4` or `34-5/8" W x 60" H` into width and height text. */
export function splitSize(raw: string): { width: string; height: string } | null {
  const parts = raw.split(/\s*[x×X]\s*/);
  if (parts.length !== 2) return null;
  const clean = (p: string) => p.replace(/\b[WH]\b\.?/gi, "").replace(/[()]/g, "").trim();
  return { width: clean(parts[0]), height: clean(parts[1]) };
}

/** 34.625 → `34 5/8"`; falls back to the decimal when not a sixteenth. */
export function formatInches(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const whole = Math.floor(v);
  const sixteenths = Math.round((v - whole) * 16);
  if (Math.abs((v - whole) * 16 - sixteenths) > 1e-9) return `${v}"`;
  if (sixteenths === 0) return `${whole}"`;
  let n = sixteenths;
  let d = 16;
  while (n % 2 === 0) {
    n /= 2;
    d /= 2;
  }
  return whole ? `${whole} ${n}/${d}"` : `${n}/${d}"`;
}
