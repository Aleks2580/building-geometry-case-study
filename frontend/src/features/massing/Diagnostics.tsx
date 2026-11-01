import { useId } from "react";
import type { Diagnostic } from "../../api/contracts";
import shared from "./massing.module.css";
import styles from "./Diagnostics.module.css";

const severityLabels: Record<Diagnostic["severity"], string> = {
  info: "Info",
  warning: "Warning",
  error: "Error",
};

export default function Diagnostics({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const titleId = useId();

  return (
    <section className={shared.resultSection} aria-labelledby={titleId}>
      <h3 id={titleId}>Diagnostics</h3>
      {diagnostics.length === 0 ? (
        <p>No diagnostics reported.</p>
      ) : (
        // WebKit drops list semantics when CSS removes the markers.
        <ol className={styles.diagnostics} role="list" aria-label="Diagnostics">
          {diagnostics.map((diagnostic, index) => (
            <li className={styles.diagnostic} data-severity={diagnostic.severity} key={`${diagnostic.code}-${index}`}>
              <p className={styles.diagnosticMeta}>
                <strong>{severityLabels[diagnostic.severity]}</strong>{" · "}
                <code>{diagnostic.code}</code>
              </p>
              <p>{diagnostic.message}</p>
              {diagnostic.path != null && (
                <dl className={styles.diagnosticDetails}>
                  <div>
                    <dt>Path</dt>
                    <dd><code>{diagnostic.path}</code></dd>
                  </div>
                </dl>
              )}
              {diagnostic.details != null && Object.keys(diagnostic.details).length > 0 && (
                <details>
                  <summary>Details</summary>
                  <dl className={styles.diagnosticDetails}>
                    {Object.entries(diagnostic.details).map(([name, value]) => (
                      <div key={name}>
                        <dt>{name}</dt>
                        <dd><code>{value === "" ? '""' : String(value)}</code></dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
