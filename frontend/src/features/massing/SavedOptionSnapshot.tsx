import { useEffect, useId, useRef, type ReactNode } from "react";
import type { OptionResponse } from "../../api/contracts";
import MassingResult from "./results/MassingResult";
import WorkspaceActionBar from "./WorkspaceActionBar";
import styles from "./MassingWorkspace.module.css";

export default function SavedOptionSnapshot({ option, onCreateBranch, onStartRoot, navigation }: {
  option: OptionResponse;
  onCreateBranch: () => void;
  onStartRoot: () => void;
  navigation?: ReactNode;
}) {
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (title.current?.closest("[hidden]")) return;
    title.current?.focus({ preventScroll: true });
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

  return <div className={styles.session}>
    <div className={styles.workspaceScroll}>
      {navigation}
      <div className={styles.workspace}>
        <section className={styles.savedConfiguration} aria-label="Saved configuration">
          <div className={styles.savedHeading}>
            <p className={styles.savedLabel}>Saved design</p>
            <h2 id={titleId} ref={title} tabIndex={-1}>Saved option snapshot</h2>
            <strong>{option.name ?? "Unnamed option"}</strong>
            <p>Read-only design. Create a branch to explore changes.</p>
          </div>
          <details className={styles.snapshotDetails}>
            <summary>Snapshot details</summary>
            <dl className={styles.snapshotMetadata}>
              <div><dt>UUID</dt><dd>{option.id}</dd></div>
              <div><dt>Parent</dt><dd>{option.parent_id ?? "None (root option)"}</dd></div>
              <div><dt>Saved status</dt><dd>{option.feasibility_status}</dd></div>
              <div><dt>Saved at</dt><dd><time dateTime={option.created_at}>{option.created_at}</time></dd></div>
              <div><dt>Schema version</dt><dd>{option.schema_version}</dd></div>
              <div><dt>Algorithm version</dt><dd>{option.algorithm_version}</dd></div>
            </dl>
          </details>
          <div className={styles.savedFields}>
            <h3>Saved configuration</h3>
            <dl className={styles.configurationValues}>
              {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "Not set"}</dd></div>)}
            </dl>
            <details className={styles.snapshotDetails}>
              <summary>Stored site geometry</summary>
              <pre className={styles.siteJson}>{JSON.stringify(option.site_geometry, null, 2)}</pre>
            </details>
          </div>
        </section>
        <section className={styles.previewPanel} aria-label="Saved snapshot result">
          <MassingResult result={option.result} title="Saved snapshot result" />
        </section>
      </div>
    </div>
    <WorkspaceActionBar mode="saved" onNewDesign={onStartRoot} onCreateBranch={onCreateBranch} />
  </div>;
}
