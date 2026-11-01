import type { OptionComparisonResponse } from "../api/contracts";
import { optionResponse } from "./optionFixtures";
import { previewResponse } from "./massingFixtures";

export function optionComparisonResponse(): OptionComparisonResponse {
  const left = optionResponse();
  const result = previewResponse();
  result.preferences.preferred_floor_count = 4;
  result.preference_results.preferred_floor_count = 4;
  result.metrics.floor_count = 4;
  result.metrics.height_m = 14;
  result.metrics.gfa_m2 = 2584;
  result.feasibility.target_assessment.actual_m2 = 2584;
  const right = optionResponse(result, {
    id: "550e8400-e29b-41d4-a716-446655440001",
    parent_id: left.id,
    name: "Four-floor branch",
  });
  return {
    options: [left, right],
    inputs: {
      site_geometry: { left: left.site_geometry, right: right.site_geometry, changed: false },
      hard_constraints: {
        setback_m: { left: 3, right: 3, changed: false, difference: 0 },
        floor_to_floor_m: { left: 3.5, right: 3.5, changed: false, difference: 0 },
        max_height_m: { left: null, right: null, changed: false, difference: null },
        max_floors: { left: 6, right: 6, changed: false, difference: 0 },
        site_coverage_ratio: { left: null, right: null, changed: false, difference: null },
        max_footprint_m2: { left: null, right: null, changed: false, difference: null },
      },
      preferences: {
        preferred_floor_count: { left: null, right: 4, changed: true, difference: null },
        preferred_footprint_area_m2: { left: null, right: null, changed: false, difference: null },
      },
      targets: { gfa_target_m2: { left: null, right: null, changed: false, difference: null } },
    },
    metrics: {
      site_area_m2: { left: 1000, right: 1000, changed: false, difference: 0 },
      buildable_area_m2: { left: 646, right: 646, changed: false, difference: 0 },
      selected_buildable_area_m2: { left: 646, right: 646, changed: false, difference: 0 },
      footprint_area_upper_bound_m2: { left: 646, right: 646, changed: false, difference: 0 },
      gfa_upper_bound_m2: { left: 3876, right: 3876, changed: false, difference: 0 },
      generated_footprint_area_m2: { left: 646, right: 646, changed: false, difference: 0 },
      generated_gfa_capacity_m2: { left: 3876, right: 3876, changed: false, difference: 0 },
      maximum_permitted_floor_count: { left: 6, right: 6, changed: false, difference: 0 },
      footprint_area_m2: { left: 646, right: 646, changed: false, difference: 0 },
      floor_count: { left: 6, right: 4, changed: true, difference: -2 },
      height_m: { left: 21, right: 14, changed: true, difference: -7 },
      gfa_m2: { left: 3876, right: 2584, changed: true, difference: -1292 },
      site_coverage_ratio: { left: 0.646, right: 0.646, changed: false, difference: 0 },
      floor_to_floor_m: { left: 3.5, right: 3.5, changed: false, difference: 0 },
    },
    feasibility: {
      status: { left: "feasible", right: "feasible", changed: false },
      reason: { left: null, right: null, changed: false },
      hard_constraints_satisfied: { left: true, right: true, changed: false },
      target_assessment: {
        left: left.result.feasibility.target_assessment,
        right: right.result.feasibility.target_assessment,
        changed: true,
      },
    },
    diagnostics: { left: [], right: [], changed: false },
  };
}
