import { describe, expect, it } from "vitest";
import { formatCount, formatMetric, formatRatio } from "./metricFormatting";

describe("metric formatting", () => {
  it.each([
    [646, "646 m²"],
    [3876.126, "3,876.13 m²"],
    [0, "0 m²"],
    [-0, "0 m²"],
    [0.001, "<0.01 m²"],
    [Number.MIN_VALUE, "<0.01 m²"],
    [-0.001, ">-0.01 m²"],
    [-12.34, "-12.34 m²"],
    [null, "Not available"],
  ])("formats %s with its units and null meaning", (value, expected) => {
    expect(formatMetric(value, "m²")).toBe(expected);
  });

  it.each([
    [12.34, "+12.34 m²"],
    [-12.34, "-12.34 m²"],
    [0, "0 m²"],
    [0.001, "+1.00e-3 m²"],
    [-0.001, "-1.00e-3 m²"],
    [-0.0049, "-4.90e-3 m²"],
    [null, "Not available"],
  ])("preserves the sign of difference %s", (value, expected) => {
    expect(formatMetric(value, "m²", true)).toBe(expected);
  });

  it("keeps count formatting integral and ratio formatting distinct from percentages", () => {
    expect(formatCount(6)).toBe("6");
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(null)).toBe("Not available");
    expect(formatRatio(0.646)).toBe("0.646");
    expect(formatRatio(0)).toBe("0");
    expect(formatRatio(0.00001)).toBe("<0.0001");
    expect(formatRatio(null)).toBe("Not available");
  });

  it.each([
    [0.01, "+0.01"], [-0.01, "-0.01"], [0, "0"], [-0, "0"],
    [0.00001, "+1.00e-5"], [-0.00001, "-1.00e-5"],
    [Number.MIN_VALUE, "+4.94e-324"], [-Number.MIN_VALUE, "-4.94e-324"],
    [null, "Not available"],
  ])("preserves signed ratio difference %s", (value, expected) => {
    expect(formatRatio(value, true)).toBe(expected);
  });
});
