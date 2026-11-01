import { useId, useState } from "react";
import type { OptionComparisonResponse } from "../../api/contracts";
import Diagnostics from "../massing/results/Diagnostics";
import { formatCount, formatMetric, formatRatio } from "../massing/results/metricFormatting";
import MassingVisualization from "../visualization/MassingVisualization";
import styles from "./comparison.module.css";

type NumericComparison = OptionComparisonResponse["metrics"]["gfa_m2"];
type NumericRows = { label: string; value: NumericComparison; unit?: string; kind?: "count" | "ratio" }[];

function Change({ changed }: { changed: boolean }) {
  return <span className={styles.change} data-changed={changed}>{changed ? "Changed" : "Unchanged"}</span>;
}

function ValueRow({ label, left, right, changed, difference }: {
  label: string;
  left: string;
  right: string;
  changed: boolean;
  difference?: string;
}) {
  return <div className={styles.row} role="group" aria-label={label}>
    <h5>{label}</h5>
    <dl className={styles.values}>
      <div><dt>Option 1</dt><dd>{left}</dd></div>
      <div><dt>Option 2</dt><dd>{right}</dd></div>
      {difference !== undefined && <div><dt>Difference</dt><dd>{difference}</dd></div>}
      <div><dt>Comparison</dt><dd><Change changed={changed} /></dd></div>
    </dl>
  </div>;
}

function NumericGroup({ title, description, rows, primary = false }: { title: string; description?: string; rows: NumericRows; primary?: boolean }) {
  const id = useId();
  return <section className={`${styles.resultSection} ${primary ? styles.primaryMetrics : ""}`} aria-labelledby={id}>
    <h4 id={id}>{title}</h4>
    {description && <p>{description}</p>}
    {rows.map(({ label, value, unit, kind }) => {
      const format = (number: number | null) => kind === "count" ? formatCount(number)
        : kind === "ratio" ? formatRatio(number) : formatMetric(number, unit);
      return <ValueRow key={label} label={label} left={format(value.left)} right={format(value.right)}
        changed={value.changed} difference={kind === "ratio" ? formatRatio(value.difference, true) : formatMetric(value.difference, unit, true)} />;
    })}
  </section>;
}

function nullableText(value: string | boolean | null): string {
  return value === null ? "Not available" : typeof value === "boolean" ? value ? "True" : "False" : value.replace(/_/g, " ");
}

export default function ComparisonResult({ comparison }: { comparison: OptionComparisonResponse }) {
  const id = useId();
  const [displayed, setDisplayed] = useState<0 | 1>(0);
  const { options, inputs, metrics, feasibility, diagnostics } = comparison;
  const active = options[displayed];
  const hard = inputs.hard_constraints;
  const preferences = inputs.preferences;
  const targets = inputs.targets;

  return <section className={styles.results} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>Saved option comparison</h3>
    <p>Differences show Option 2 minus Option 1. Unavailable values stay unavailable.</p>
    <section className={styles.resultSection} aria-labelledby={`${id}-geometry`}>
      <h4 id={`${id}-geometry`}>Stored plan inspection</h4>
      <fieldset className={styles.planChoice}>
        <legend>Displayed saved plan</legend>
        {([0, 1] as const).map((index) => <label key={index}>
          <input type="radio" name={`${id}-plan`} checked={displayed === index} onChange={() => setDisplayed(index)} />
          {index === 0 ? "Option 1 plan" : "Option 2 plan"}
        </label>)}
      </fieldset>
      <p className={styles.planIdentity} role="status">Displaying {displayed === 0 ? "Option 1" : "Option 2"}: <strong>{active.name ?? "Unnamed option"}</strong> ({active.id}). Each view is fitted to its own saved site.</p>
      <MassingVisualization result={active.result} resultKey={active.id} />
    </section>
    <NumericGroup title="Actual massing" primary rows={[
      { label: "Footprint area", value: metrics.footprint_area_m2, unit: "m²" },
      { label: "Floor count", value: metrics.floor_count, kind: "count" },
      { label: "Height", value: metrics.height_m, unit: "m" },
      { label: "GFA", value: metrics.gfa_m2, unit: "m²" },
      { label: "Site coverage ratio", value: metrics.site_coverage_ratio, kind: "ratio" },
      { label: "Floor-to-floor height", value: metrics.floor_to_floor_m, unit: "m" },
    ]} />
    <details className={styles.detailPanel}>
      <summary>Saved snapshot details</summary>
      <div className={styles.slots}>
        {options.map((option, index) => <section className={styles.slot} key={option.id} aria-label={`${index === 0 ? "Option 1" : "Option 2"} compared option`}>
          <h4>{index === 0 ? "Option 1" : "Option 2"}: {option.name ?? "Unnamed option"}</h4>
          <dl className={styles.identity}>
            <div><dt>UUID</dt><dd>{option.id}</dd></div>
            <div><dt>Status</dt><dd>{option.feasibility_status.replace(/_/g, " ")}</dd></div>
            <div><dt>Parent</dt><dd>{option.parent_id ?? "None (root option)"}</dd></div>
            <div><dt>Saved at</dt><dd><time dateTime={option.created_at}>{option.created_at}</time></dd></div>
            <div><dt>Schema version</dt><dd>{option.schema_version}</dd></div>
            <div><dt>Algorithm version</dt><dd>{option.algorithm_version}</dd></div>
          </dl>
        </section>)}
      </div>
    </details>
    <details className={styles.detailPanel}>
      <summary>Inputs and capacity</summary>
      <div className={styles.detailContent}>
        <NumericGroup title="Hard constraints" rows={[
          { label: "Setback", value: hard.setback_m, unit: "m" },
          { label: "Floor-to-floor height constraint", value: hard.floor_to_floor_m, unit: "m" },
          { label: "Maximum height", value: hard.max_height_m, unit: "m" },
          { label: "Maximum floor count", value: hard.max_floors, kind: "count" },
          { label: "Site coverage ratio constraint", value: hard.site_coverage_ratio, kind: "ratio" },
          { label: "Maximum footprint", value: hard.max_footprint_m2, unit: "m²" },
        ]} />
        <NumericGroup title="Preferences and targets" rows={[
          { label: "Preferred floor count", value: preferences.preferred_floor_count, kind: "count" },
          { label: "Preferred footprint area", value: preferences.preferred_footprint_area_m2, unit: "m²" },
          { label: "GFA target", value: targets.gfa_target_m2, unit: "m²" },
        ]} />
        <section className={styles.resultSection} aria-labelledby={`${id}-site`}>
          <h4 id={`${id}-site`}>Site geometry</h4>
          <p><Change changed={inputs.site_geometry.changed} />. Compares saved coordinates, including vertex and ring order; this is not a topological equivalence test.</p>
          <div className={styles.slots}>
            {(["left", "right"] as const).map((side) => <details key={side} className={styles.geometry}>
              <summary>{side === "left" ? "Option 1" : "Option 2"} stored site geometry</summary>
              <pre>{JSON.stringify(inputs.site_geometry[side], null, 2)}</pre>
            </details>)}
          </div>
        </section>
        <NumericGroup title="Site and setback metrics" rows={[
          { label: "Site area", value: metrics.site_area_m2, unit: "m²" },
          { label: "Complete buildable area", value: metrics.buildable_area_m2, unit: "m²" },
          { label: "Selected buildable component area", value: metrics.selected_buildable_area_m2, unit: "m²" },
        ]} />
        <NumericGroup title="Hard upper bounds" description="Theoretical hard upper bounds do not guarantee that a building footprint or this GFA can be achieved." rows={[
          { label: "Maximum permitted floor count", value: metrics.maximum_permitted_floor_count, kind: "count" },
          { label: "Hard footprint area upper bound", value: metrics.footprint_area_upper_bound_m2, unit: "m²" },
          { label: "Hard GFA upper bound", value: metrics.gfa_upper_bound_m2, unit: "m²" },
        ]} />
        <NumericGroup title="Generated default capacity" description="Measured default construction at the maximum permitted floor count, before preferences and target-driven floor selection. Demonstrated capacity is not a proven optimum." rows={[
          { label: "Generated default footprint area", value: metrics.generated_footprint_area_m2, unit: "m²" },
          { label: "Generated default GFA capacity", value: metrics.generated_gfa_capacity_m2, unit: "m²" },
        ]} />
      </div>
    </details>
    <details className={styles.detailPanel}>
      <summary>Feasibility and diagnostics</summary>
      <div className={styles.detailContent}>
        <section className={styles.resultSection} aria-labelledby={`${id}-feasibility`}>
          <h4 id={`${id}-feasibility`}>Feasibility</h4>
          <ValueRow label="Feasibility status" left={nullableText(feasibility.status.left)} right={nullableText(feasibility.status.right)} changed={feasibility.status.changed} />
          <ValueRow label="Reason" left={feasibility.reason.left ?? "Not available"} right={feasibility.reason.right ?? "Not available"} changed={feasibility.reason.changed} />
          <ValueRow label="Hard constraints satisfied" left={nullableText(feasibility.hard_constraints_satisfied.left)} right={nullableText(feasibility.hard_constraints_satisfied.right)} changed={feasibility.hard_constraints_satisfied.changed} />
          <p>Generation failed means construction failed; it does not establish mathematical infeasibility.</p>
          <h5>GFA target assessment</h5>
          <p>Assessment comparison: <Change changed={feasibility.target_assessment.changed} /></p>
          <div className={styles.slots}>
            {(["left", "right"] as const).map((side) => {
              const target = feasibility.target_assessment[side];
              return <section className={styles.slot} key={side} aria-label={`${side === "left" ? "Option 1" : "Option 2"} target assessment`}>
                <h5>{side === "left" ? "Option 1" : "Option 2"}</h5>
                <dl className={styles.identity}>
                  <div><dt>Status</dt><dd>{nullableText(target.status)}</dd></div>
                  <div><dt>Requested GFA</dt><dd>{formatMetric(target.requested_m2, "m²")}</dd></div>
                  <div><dt>Actual GFA</dt><dd>{formatMetric(target.actual_m2, "m²")}</dd></div>
                  <div><dt>Shortfall</dt><dd>{formatMetric(target.shortfall_m2, "m²")}</dd></div>
                  <div><dt>Diagnostic code</dt><dd>{target.diagnostic_code ?? "Not available"}</dd></div>
                </dl>
              </section>;
            })}
          </div>
        </section>
        <section className={styles.resultSection} aria-labelledby={`${id}-diagnostics`}>
          <h4 id={`${id}-diagnostics`}>Diagnostic comparison</h4>
          <p>Complete ordered diagnostic lists: <Change changed={diagnostics.changed} /></p>
          <div className={styles.slots}>
            {(["left", "right"] as const).map((side) => <section className={styles.slot} key={side} aria-label={`${side === "left" ? "Option 1" : "Option 2"} diagnostics`}>
              <h5>{side === "left" ? "Option 1" : "Option 2"}</h5>
              <Diagnostics diagnostics={diagnostics[side]} />
            </section>)}
          </div>
        </section>
      </div>
    </details>
  </section>;
}
