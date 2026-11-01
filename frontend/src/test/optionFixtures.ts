import type { MassingPreviewResponse, OptionResponse } from "../api/contracts";
import { previewResponse } from "./massingFixtures";

export function optionResponse(
  result: MassingPreviewResponse = previewResponse(),
  overrides: Partial<OptionResponse> = {},
): OptionResponse {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    parent_id: null,
    name: "Rectangle study",
    schema_version: 1,
    algorithm_version: "massing-v1;shapely=2.1.2;geos=3.13.1",
    feasibility_status: result.feasibility.status,
    created_at: "2026-10-31T08:00:00Z",
    site_geometry: result.site,
    hard_constraints: result.hard_constraints,
    preferences: result.preferences,
    targets: result.targets,
    result,
    ...overrides,
  };
}
