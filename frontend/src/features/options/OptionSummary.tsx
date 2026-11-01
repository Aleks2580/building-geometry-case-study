import { useId } from "react";
import type { OptionSummary as SavedSummary } from "../../api/contracts";
import { formatCount, formatMetric, formatRatio } from "../massing/metricFormatting";
import styles from "./OptionSummary.module.css";

export default function OptionSummary({ option }: { option: SavedSummary }) {
  const titleId = useId();
  const { metrics } = option;
  const values = [
    ["Name", option.name ?? "Unnamed option"],
    ["UUID", option.id],
    ["Status", option.feasibility_status.replace(/_/g, " ")],
    ["Parent", option.parent_id ?? "None (root option)"],
    ["Site area", formatMetric(metrics.site_area_m2, "m²")],
    ["Footprint area", formatMetric(metrics.footprint_area_m2, "m²")],
    ["Floor count", formatCount(metrics.floor_count)],
    ["Height", formatMetric(metrics.height_m, "m")],
    ["GFA", formatMetric(metrics.gfa_m2, "m²")],
    ["Site coverage ratio", formatRatio(metrics.site_coverage_ratio)],
    ["Maximum permitted floors", formatCount(metrics.maximum_permitted_floor_count)],
    ["Hard GFA upper bound", formatMetric(metrics.gfa_upper_bound_m2, "m²")],
  ];

  return (
    <section className={styles.summary} aria-labelledby={titleId}>
      <h4 id={titleId}>Selected option summary</h4>
      <dl className={styles.values}>
        {values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        <div><dt>Saved at</dt><dd><time dateTime={option.created_at}>{option.created_at}</time></dd></div>
      </dl>
    </section>
  );
}
