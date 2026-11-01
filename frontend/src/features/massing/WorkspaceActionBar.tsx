import styles from "./WorkspaceActionBar.module.css";

type WorkspaceActionBarProps = { onNewDesign: () => void } & (
  | { mode: "edit"; formId: string; isGenerating: boolean }
  | { mode: "saved"; onCreateBranch: () => void }
);

export default function WorkspaceActionBar(props: WorkspaceActionBarProps) {
  return <div className={styles.bar} role="group" aria-label="Workspace actions">
    <button type="button" onClick={props.onNewDesign}>New design</button>
    <p className={styles.hint}>{props.mode === "saved"
      ? "Saved design · Create a branch to explore changes."
      : props.isGenerating
        ? "Keep editing or submit again to update the preview."
        : "Preview only · Unsaved changes remain in your workspace"}</p>
    {props.mode === "edit" ? <button className={styles.primary} type="submit" form={props.formId}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M7 4l9 6-9 6z" /></svg>
      Generate Preview
    </button> : <button className={styles.primary} type="button" onClick={props.onCreateBranch}>Create Branch</button>}
  </div>;
}
