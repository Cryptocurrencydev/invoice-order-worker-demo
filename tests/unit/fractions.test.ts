import { describe, expect, it } from "vitest";
import { formatInches, parseInches, splitSize } from "@/lib/fractions";

describe("parseInches", () => {
  it.each([
    ["34 5/8", 34.625], ["34-5/8", 34.625], ['34 5/8"', 34.625], ["34⅝", 34.625], ["34 ⅝", 34.625], ["34.625", 34.625],
    ["34", 34], ["60 1/16", 60.0625], ["72 1/2 in", 72.5], ["W 34 5/8", 34.625], ["5/8", 0.625], ["34 5 / 8", 34.625], ["120.000", 120],
    ["48¾", 48.75], ["35 7/8″", 35.875],
  ])("%s → %s", (raw, expected) => {
    const r = parseInches(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(expected);
  });

  it.each([["34 5/7"], ["34 9/8"], ["34 0/8"], [""], ["TBD"], ["abc"], ["-3"], ["457/8"], ["34 5/8 x 60"]])("rejects %j", (raw) => {
    expect(parseInches(raw).ok).toBe(false);
  });

  it("treats null as missing", () => expect(parseInches(null)).toEqual({ ok: false, error: "missing" }));
  it("is exact for every sixteenth", () => {
    for (let i = 1; i < 16; i++) {
      const r = parseInches(`10 ${i % 2 ? i : i / 2}/${i % 2 ? 16 : 8}`);
      expect(r.ok && r.value).toBe(10 + i / 16);
    }
  });
});

describe("splitSize / formatInches", () => {
  it("splits combined sizes", () => {
    expect(splitSize('34 5/8 x 60 1/4')).toEqual({ width: "34 5/8", height: "60 1/4" });
    expect(splitSize('34-5/8" W × 60" H')).toEqual({ width: '34-5/8"', height: '60"' });
    expect(splitSize("34 5/8")).toBeNull();
  });
  it("formats", () => {
    expect(formatInches(34.625)).toBe('34 5/8"');
    expect(formatInches(60)).toBe('60"');
    expect(formatInches(60.0625)).toBe('60 1/16"');
    expect(formatInches(12.3)).toBe('12.3"');
    expect(formatInches(null)).toBe("—");
  });
});
