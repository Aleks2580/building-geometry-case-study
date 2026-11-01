import type { ReactNode } from "react";
import type { MassingPreviewResponse } from "../../../api/contracts";
import MassingVisualization from "../../visualization/MassingVisualization";
import DetailedMetrics from "./DetailedMetrics";
import Diagnostics from "./Diagnostics";
import FeasibilitySummary from "./FeasibilitySummary";
import PreferenceAssessments from "./PreferenceAssessments";
import { formatCount, formatMetric, formatRatio } from "./metricFormatting";
import styles from "./MassingResult.module.css";

export default function MassingResult({ result, title = "Massing preview", actions }: {
  result: MassingPreviewResponse;
  title?: string;
  actions?: ReactNode;
}) {
  const { metrics, hard_constraints: constraints } = result;
  const diagnostics = result.feasibility.diagnostics;
  const cards = [
    {
      label: "Footprint",
      value: formatMetric(metrics.footprint_area_m2, "m²"),
      hint: `Hard upper bound: ${formatMetric(metrics.footprint_area_upper_bound_m2, "m²")}`,
      icon: "M4 4h16v16H4zM4 4l16 16M4 10l10 10M10 4l10 10",
    },
    {
      label: "GFA",
      value: formatMetric(metrics.gfa_m2, "m²"),
      hint: `Hard upper bound: ${formatMetric(metrics.gfa_upper_bound_m2, "m²")}`,
      icon: "M4 4h16v16H4zM4 8h16M4 12h16M4 16h16",
    },
    {
      label: "Floors",
      value: formatCount(metrics.floor_count),
      hint: `Maximum permitted: ${formatCount(metrics.maximum_permitted_floor_count)}`,
      icon: "M4 4h16v16H4zM8 4v16M12 4v16M16 4v16",
    },
    {
      label: "Height",
      value: formatMetric(metrics.height_m, "m"),
      hint: constraints.max_height_m === null ? "No height limit set" : `Height limit: ${formatMetric(constraints.max_height_m, "m")}`,
      icon: "M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5",
    },
  ];

  return <div className={styles.dashboard}>
    <div className={styles.summaryPanel}>
      <div className={styles.resultHeading}>
        <div><h2>{title}</h2><p>Explore your design, its geometry, and key metrics.</p></div>
        <FeasibilitySummary feasibility={result.feasibility} compact />
      </div>
      <section aria-label="Actual massing">
        <dl className={styles.kpis}>
          {cards.map(({ label, value, hint, icon }) => <div className={styles.kpi} key={label}>
            <dt><span className={styles.kpiIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d={icon} /></svg></span>{label}</dt>
            <dd>{value}</dd>
            <dd className={styles.kpiHint}>{hint}</dd>
          </div>)}
        </dl>
      </section>
    </div>
    <div className={styles.visualPanel}>
      <div className={styles.viewerLayout}>
        <MassingVisualization result={result} />
        <aside className={styles.optionDetails} aria-label="Option details">
          <h3>Option details</h3>
          <p>Current result summary</p>
          <dl>
            <div><dt>Site area</dt><dd>{formatMetric(metrics.site_area_m2, "m²")}</dd></div>
            <div><dt>Buildable area</dt><dd>{formatMetric(metrics.buildable_area_m2, "m²")}</dd></div>
            <div><dt>Site coverage</dt><dd>{formatRatio(metrics.site_coverage_ratio)}</dd></div>
            <div><dt>Floor-to-floor</dt><dd>{formatMetric(metrics.floor_to_floor_m, "m")}</dd></div>
          </dl>
          <h4>Constraints</h4>
          <dl>
            <div><dt>Setback</dt><dd>{formatMetric(constraints.setback_m, "m")}</dd></div>
            <div><dt>Maximum floors</dt><dd>{constraints.max_floors === null ? "Not set" : formatCount(constraints.max_floors)}</dd></div>
            <div><dt>Maximum height</dt><dd>{constraints.max_height_m === null ? "Not set" : formatMetric(constraints.max_height_m, "m")}</dd></div>
          </dl>
        </aside>
      </div>
      {actions && <div className={styles.resultActions}>{actions}</div>}
    </div>
    <div className={styles.disclosures}>
      <details className={styles.disclosure}>
        <summary>Metrics &amp; capacity <span>Areas, constraints, and construction capacity</span></summary>
        <div className={styles.disclosureBody}><DetailedMetrics result={result} includeActual={false} /></div>
      </details>
      <details className={styles.disclosure}>
        <summary>Preferences &amp; target <span>Requested values and assessments</span></summary>
        <div className={styles.disclosureBody}><PreferenceAssessments result={result} /></div>
      </details>
      <details className={styles.disclosure} open={diagnostics.some((diagnostic) => diagnostic.severity === "error")}>
        <summary>Diagnostics <span>{diagnostics.length === 0 ? "No issues reported" : `${diagnostics.length} ${diagnostics.length === 1 ? "message" : "messages"}`}</span></summary>
        <div className={styles.disclosureBody}><Diagnostics diagnostics={diagnostics} /></div>
      </details>
    </div>
  </div>;
}
