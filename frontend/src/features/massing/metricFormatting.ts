const metricFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const ratioFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

export function formatMetric(value: number | null, unit = "", signed = false): string {
  if (value === null) return "Not available";

  let formatted: string;
  // Preserve nonzero magnitudes and the direction of preference differences;
  // rounding these to zero would imply an exact match the backend did not report.
  if (value !== 0 && Math.abs(value) < 0.01) {
    formatted = signed
      ? `${value > 0 ? "+" : ""}${value.toExponential(2)}`
      : value > 0 ? "<0.01" : ">-0.01";
  } else {
    formatted = `${signed && value > 0 ? "+" : ""}${metricFormat.format(value === 0 ? 0 : value)}`;
  }

  return `${formatted}${unit ? ` ${unit}` : ""}`;
}

export function formatCount(value: number | null): string {
  return value === null ? "Not available" : countFormat.format(value === 0 ? 0 : value);
}

export function formatRatio(value: number | null): string {
  if (value === null) return "Not available";
  return value > 0 && value < 0.0001 ? "<0.0001" : ratioFormat.format(value === 0 ? 0 : value);
}
