import { useEffect, useId, useRef } from "react";
import type { OptionResponse } from "../../api/contracts";
import MassingResult from "./MassingResult";
import shared from "./massing.module.css";
import styles from "./MassingWorkspace.module.css";

export default function SavedOptionSnapshot({ option, onCreateBranch, onStartRoot }: {
  option: OptionResponse;
  onCreateBranch: () => void;
  onStartRoot: () => void;
}) {
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
    title.current?.scrollIntoView?.({ block: "start" });
  }, []);
  const fields: [string, number | null][] = [
    ["Setback (m)", option.hard_constraints.setback_m],
    ["Floor-to-floor height (m)", option.hard_constraints.floor_to_floor_m],
    ["Maximum height (m)", option.hard_constraints.max_height_m],
    ["Maximum floor count", option.hard_constraints.max_floors],
    ["Site coverage ratio", option.hard_constraints.site_coverage_ratio],
    ["Maximum footprint (m²)", option.hard_constraints.max_footprint_m2],
    ["Preferred floor count", option.preferences.preferred_floor_count],
    ["Preferred footprint (m²)", option.preferences.preferred_footprint_area_m2],
    ["GFA target (m²)", option.targets.gfa_target_m2],
  ];

  return <section aria-labelledby={titleId}>
    <div className={styles.context}>
      <h2 id={titleId} ref={title} tabIndex={-1}>Saved option snapshot</h2>
      <p>Read-only immutable snapshot. Configuration, geometry, and results are stored values; opening does not generate a preview.</p>
      <dl className={styles.snapshotMetadata}>
        <div><dt>Snapshot name</dt><dd>{option.name ?? "Unnamed option"}</dd></div>
        <div><dt>UUID</dt><dd>{option.id}</dd></div>
        <div><dt>Parent</dt><dd>{option.parent_id ?? "None (root option)"}</dd></div>
        <div><dt>Saved status</dt><dd>{option.feasibility_status}</dd></div>
        <div><dt>Saved at</dt><dd><time dateTime={option.created_at}>{option.created_at}</time></dd></div>
        <div><dt>Schema version</dt><dd>{option.schema_version}</dd></div>
        <div><dt>Algorithm version</dt><dd>{option.algorithm_version}</dd></div>
      </dl>
      <div className={styles.actions}>
        <button type="button" onClick={onCreateBranch}>Create Branch</button>
        <button type="button" onClick={onStartRoot}>Start New Root</button>
      </div>
    </div>
    <div className={styles.workspace}>
      <section className={`${shared.panel} ${styles.editor}`} aria-label="Saved configuration">
        <h3>Saved configuration</h3>
        <dl className={styles.configurationValues}>
          {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "Not set"}</dd></div>)}
        </dl>
        <details>
          <summary>Stored site geometry</summary>
          <pre className={styles.siteJson}>{JSON.stringify(option.site_geometry, null, 2)}</pre>
        </details>
      </section>
      <section className={`${shared.panel} ${styles.previewPanel}`} aria-label="Saved snapshot result">
        <p className={shared.eyebrow}>Stored backend result</p>
        <h3>Saved snapshot result</h3>
        <MassingResult result={option.result} />
      </section>
    </div>
  </section>;
}
