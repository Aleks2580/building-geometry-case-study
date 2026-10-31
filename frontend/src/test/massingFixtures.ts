import type {
  MassingPreviewRequest,
  MassingPreviewResponse,
  PolygonGeometry,
} from "../api/contracts";

export function previewRequest(): MassingPreviewRequest {
  return {
    site: {
      type: "Polygon",
      coordinates: [[[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]]],
    },
    hard_constraints: { setback_m: 3, floor_to_floor_m: 3.5, max_floors: 6 },
  };
}

export function previewResponse(): MassingPreviewResponse {
  const request = previewRequest();
  const footprint: PolygonGeometry = {
    type: "Polygon",
    coordinates: [[[3, 3], [37, 3], [37, 22], [3, 22], [3, 3]]],
  };

  return {
    ...request,
    hard_constraints: {
      ...request.hard_constraints,
      max_floors: 6,
      max_height_m: null,
      site_coverage_ratio: null,
      max_footprint_m2: null,
    },
    preferences: { preferred_floor_count: null, preferred_footprint_area_m2: null },
    targets: { gfa_target_m2: null },
    site_geometry: request.site,
    buildable_geometry: footprint,
    selected_buildable_geometry: footprint,
    generated_footprint_geometry: footprint,
    footprint_geometry: footprint,
    floor_plate_geometry: footprint,
    metrics: {
      site_area_m2: 1000,
      buildable_area_m2: 646,
      selected_buildable_area_m2: 646,
      footprint_area_upper_bound_m2: 646,
      gfa_upper_bound_m2: 3876,
      generated_footprint_area_m2: 646,
      generated_gfa_capacity_m2: 3876,
      maximum_permitted_floor_count: 6,
      footprint_area_m2: 646,
      floor_count: 6,
      height_m: 21,
      gfa_m2: 3876,
      site_coverage_ratio: 0.646,
      floor_to_floor_m: 3.5,
    },
    setback: { component_count: 1, retained_area_m2: 646, discarded_area_m2: 0 },
    preference_results: { preferred_floor_count: null, footprint_area: null },
    feasibility: {
      status: "feasible",
      reason: null,
      hard_constraints_satisfied: true,
      target_assessment: {
        requested_m2: null,
        actual_m2: 3876,
        shortfall_m2: null,
        status: "not_requested",
        diagnostic_code: null,
      },
      diagnostics: [],
    },
  };
}
