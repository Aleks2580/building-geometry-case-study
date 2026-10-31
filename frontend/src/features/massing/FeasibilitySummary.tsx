import { useId } from "react";
import type { FeasibilityStatus, MassingFeasibility } from "../../api/contracts";
import shared from "./massing.module.css";
import styles from "./FeasibilitySummary.module.css";

const statusContent: Record<FeasibilityStatus, { title: string; description: string }> = {
  feasible: {
    title: "Feasible",
    description: "The generated massing satisfies the hard constraints.",
  },
  feasible_target_unmet: {
    title: "Feasible — GFA target unmet",
    description: "The generated massing satisfies the hard constraints but misses the GFA target.",
  },
  infeasible: {
    title: "Infeasible",
    description: "The backend found no buildable massing under these constraints.",
  },
  generation_failed: {
    title: "Generation failed",
    description: "The backend could not construct a footprint. This does not establish mathematical infeasibility.",
  },
};

export default function FeasibilitySummary({ feasibility }: { feasibility: MassingFeasibility }) {
  const titleId = useId();
  const status = statusContent[feasibility.status];
  const satisfied = feasibility.hard_constraints_satisfied;

  return (
    <section
      className={styles.previewStatus}
      data-status={feasibility.status}
      role="status"
      aria-labelledby={titleId}
    >
      <h3 id={titleId}>{status.title}</h3>
      <p>{status.description}</p>
      <dl className={shared.metricDetails}>
        <div>
          <dt>Hard constraints satisfied</dt>
          <dd>{satisfied === null ? "Unknown" : satisfied ? "True" : "False"}</dd>
        </div>
        {feasibility.reason !== null && (
          <div>
            <dt>Backend reason</dt>
            <dd><code>{feasibility.reason}</code></dd>
          </div>
        )}
      </dl>
    </section>
  );
}
