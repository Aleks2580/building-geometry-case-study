import { useId } from "react";
import type { MassingPreviewResponse } from "../../api/contracts";
import { formatCount, formatMetric, formatRatio } from "./metricFormatting";

export default function DetailedMetrics({ result }: { result: MassingPreviewResponse }) {
  const id = useId();
  const { metrics, setback } = result;
  const actual = [
    ["Footprint area", formatMetric(metrics.footprint_area_m2, "m²")],
    ["Floor count", formatCount(metrics.floor_count)],
    ["Height", formatMetric(metrics.height_m, "m")],
    ["GFA", formatMetric(metrics.gfa_m2, "m²")],
  ];
  const groups = [
    {
      name: "Site and setback",
      rows: [
        ["Site area", formatMetric(metrics.site_area_m2, "m²")],
        ["Complete buildable area", formatMetric(metrics.buildable_area_m2, "m²")],
        ["Selected buildable component area", formatMetric(metrics.selected_buildable_area_m2, "m²")],
        ["Setback component count", formatCount(setback.component_count)],
        ["Retained setback area", formatMetric(setback.retained_area_m2, "m²")],
        ["Discarded setback area", formatMetric(setback.discarded_area_m2, "m²")],
      ],
    },
    {
      name: "Hard constraints and capacity",
      description: "These theoretical upper bounds do not guarantee that a footprint can be constructed or that this GFA can be achieved.",
      rows: [
        ["Maximum permitted floor count", formatCount(metrics.maximum_permitted_floor_count)],
        ["Hard footprint area upper bound", formatMetric(metrics.footprint_area_upper_bound_m2, "m²")],
        ["Hard GFA upper bound", formatMetric(metrics.gfa_upper_bound_m2, "m²")],
      ],
    },
    {
      name: "Generated default capacity",
      description: "Measured default construction at the maximum permitted floor count, before preferences and target-driven floor selection. This is demonstrated capacity, not a proven optimum.",
      rows: [
        ["Generated default footprint area", formatMetric(metrics.generated_footprint_area_m2, "m²")],
        ["Generated default GFA capacity", formatMetric(metrics.generated_gfa_capacity_m2, "m²")],
      ],
    },
  ];

  return (
    <>
      <section className="result-section" aria-labelledby={`${id}-actual`}>
        <h3 id={`${id}-actual`}>Actual massing</h3>
        <dl className="metrics">
          {actual.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <dl className="metric-details">
          <div><dt>Site coverage ratio</dt><dd>{formatRatio(metrics.site_coverage_ratio)}</dd></div>
          <div><dt>Floor-to-floor height</dt><dd>{formatMetric(metrics.floor_to_floor_m, "m")}</dd></div>
        </dl>
      </section>
      {groups.map(({ name, description, rows }, index) => (
        <section className="result-section" aria-labelledby={`${id}-${index}`} key={name}>
          <h3 id={`${id}-${index}`}>{name}</h3>
          {description && <p className="result-hint">{description}</p>}
          <dl className="metric-details">
            {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </section>
      ))}
    </>
  );
}
