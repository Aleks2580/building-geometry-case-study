import { useId } from "react";
import type { FeasibilityStatus, MassingFeasibility } from "../../../api/contracts";
import shared from "../massing.module.css";
import styles from "./FeasibilitySummary.module.css";

const statusContent: Record<FeasibilityStatus, { title: string; description: string; summary: string }> = {
  feasible: {
    title: "Feasible",
    summary: "Within all hard constraints.",
    description: "The generated massing satisfies the hard constraints.",
  },
  feasible_target_unmet: {
    title: "Feasible — GFA target unmet",
    summary: "Within hard constraints; GFA target unmet.",
    description: "The generated massing satisfies the hard constraints but misses the GFA target.",
  },
  infeasible: {
    title: "Infeasible",
    summary: "No massing under these constraints.",
    description: "No buildable massing was found under these constraints.",
  },
  generation_failed: {
    title: "Generation failed",
    summary: "No footprint generated; feasibility unknown.",
    description: "A footprint could not be constructed. This does not establish mathematical infeasibility.",
  },
};

export default function FeasibilitySummary({ feasibility, compact = false }: { feasibility: MassingFeasibility; compact?: boolean }) {
  const titleId = useId();
  const status = statusContent[feasibility.status];
  const satisfied = feasibility.hard_constraints_satisfied;

  return (
    <section
      className={`${styles.previewStatus}${compact ? ` ${styles.compact}` : ""}`}
      data-status={feasibility.status}
      role="status"
      aria-labelledby={titleId}
    >
      <h3 id={titleId}>{status.title}</h3>
      <p>{compact ? status.summary : status.description}</p>
      <dl className={shared.metricDetails}>
        <div>
          <dt>Hard constraints satisfied</dt>
          <dd>{satisfied === null ? "Unknown" : satisfied ? "True" : "False"}</dd>
        </div>
        {feasibility.reason !== null && (
          <div>
            <dt>Reason</dt>
            <dd><code>{feasibility.reason}</code></dd>
          </div>
        )}
      </dl>
    </section>
  );
}
