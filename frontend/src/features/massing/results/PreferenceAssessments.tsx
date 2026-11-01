import { useId } from "react";
import type { FootprintAreaPreferenceResult, GfaTargetAssessment, MassingPreviewResponse } from "../../../api/contracts";
import { formatCount, formatMetric } from "./metricFormatting";
import shared from "../massing.module.css";

const footprintStatus: Record<FootprintAreaPreferenceResult["status"], string> = {
  met: "Met",
  clamped: "Clamped",
  approximated: "Approximated",
  unmet: "Unmet",
};

const targetStatus: Record<GfaTargetAssessment["status"], string> = {
  not_requested: "Not requested",
  met: "Met",
  unmet: "Unmet",
  not_evaluated: "Not evaluated",
};

export default function PreferenceAssessments({ result }: { result: MassingPreviewResponse }) {
  const id = useId();
  const { preferred_floor_count: floorCount, footprint_area: footprint } = result.preference_results;
  // Hard infeasibility can stop construction before a supplied preference is assessed.
  const requestedFootprint = footprint === null
    ? result.preferences.preferred_footprint_area_m2
    : footprint.requested_area_m2;
  const target = result.feasibility.target_assessment;

  return (
    <section className={shared.resultSection} aria-labelledby={`${id}-assessments`}>
      <h3 id={`${id}-assessments`}>Preferences and target</h3>
      <dl className={shared.metricDetails}>
        <div><dt>Preferred floor count</dt><dd>{floorCount === null ? "Not requested" : formatCount(floorCount)}</dd></div>
      </dl>
      <section aria-labelledby={`${id}-footprint`}>
        <h4 id={`${id}-footprint`}>Footprint preference</h4>
        {requestedFootprint === null ? <p>Not requested</p> : (
          <>
            <p>{footprint === null
              ? "No footprint assessment was returned for the requested area."
              : "The effective target applies the hard area cap. The signed difference compares actual area with the requested area."}</p>
            <dl className={shared.metricDetails}>
              <div><dt>Footprint assessment</dt><dd>{footprint === null ? "Not available" : footprintStatus[footprint.status]}</dd></div>
              <div><dt>Requested footprint area</dt><dd>{formatMetric(requestedFootprint, "m²")}</dd></div>
              <div><dt>Effective footprint target</dt><dd>{formatMetric(footprint?.effective_target_m2 ?? null, "m²")}</dd></div>
              <div><dt>Actual preferred footprint area</dt><dd>{formatMetric(footprint?.actual_area_m2 ?? null, "m²")}</dd></div>
              <div><dt>Signed footprint difference</dt><dd>{formatMetric(footprint?.difference_m2 ?? null, "m²", true)}</dd></div>
              <div><dt>Effective-target undershoot</dt><dd>{formatMetric(footprint?.effective_target_undershoot_m2 ?? null, "m²")}</dd></div>
            </dl>
          </>
        )}
      </section>
      <section aria-labelledby={`${id}-target`}>
        <h4 id={`${id}-target`}>GFA target</h4>
        <dl className={shared.metricDetails}>
          <div><dt>GFA target assessment</dt><dd>{targetStatus[target.status]}</dd></div>
          <div><dt>Requested GFA target</dt><dd>{target.requested_m2 === null ? "Not requested" : formatMetric(target.requested_m2, "m²")}</dd></div>
          <div><dt>Actual GFA for target</dt><dd>{formatMetric(target.actual_m2, "m²")}</dd></div>
          <div><dt>GFA shortfall</dt><dd>{formatMetric(target.shortfall_m2, "m²")}</dd></div>
        </dl>
      </section>
    </section>
  );
}
