import { z } from "zod";

const positiveNumber = z.number().positive();
const nonNegativeNumber = z.number().nonnegative();
const positiveInteger = z.int().positive();
const nonNegativeInteger = z.int().nonnegative();
const positionSchema = z.tuple([z.number(), z.number()]);
const polygonCoordinates = z.array(z.array(positionSchema).min(4)).min(1);

const polygonGeometrySchema = z.object({
  type: z.literal("Polygon"),
  coordinates: polygonCoordinates,
});

const multiPolygonGeometrySchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(polygonCoordinates).min(1),
});

const hardConstraintsSchema = z.object({
  setback_m: nonNegativeNumber,
  floor_to_floor_m: positiveNumber,
  max_height_m: positiveNumber.nullable().default(null),
  max_floors: positiveInteger.nullable().default(null),
  site_coverage_ratio: positiveNumber.max(1).nullable().default(null),
  max_footprint_m2: positiveNumber.nullable().default(null),
}).refine((value) => value.max_height_m !== null || value.max_floors !== null);

const designPreferencesSchema = z.object({
  preferred_floor_count: positiveInteger.nullable().default(null),
  preferred_footprint_area_m2: positiveNumber.nullable().default(null),
});

const designTargetsSchema = z.object({
  gfa_target_m2: nonNegativeNumber.nullable().default(null),
});

// Defaults mirror Pydantic: request fields may be omitted, while parsed responses
// expose nullable values. Response objects accept additive fields for API v1 evolution.
export const massingPreviewRequestSchema = z.object({
  site: polygonGeometrySchema,
  hard_constraints: hardConstraintsSchema,
  preferences: designPreferencesSchema.prefault({}),
  targets: designTargetsSchema.prefault({}),
});

const massingMetricsSchema = z.object({
  site_area_m2: positiveNumber,
  buildable_area_m2: nonNegativeNumber,
  selected_buildable_area_m2: nonNegativeNumber,
  footprint_area_upper_bound_m2: nonNegativeNumber,
  gfa_upper_bound_m2: nonNegativeNumber,
  generated_footprint_area_m2: positiveNumber.nullable(),
  generated_gfa_capacity_m2: positiveNumber.nullable(),
  maximum_permitted_floor_count: nonNegativeInteger,
  footprint_area_m2: positiveNumber.nullable(),
  floor_count: positiveInteger.nullable(),
  height_m: positiveNumber.nullable(),
  gfa_m2: positiveNumber.nullable(),
  site_coverage_ratio: nonNegativeNumber.nullable(),
  floor_to_floor_m: positiveNumber,
});

const setbackSummarySchema = z.object({
  component_count: nonNegativeInteger,
  retained_area_m2: nonNegativeNumber,
  discarded_area_m2: nonNegativeNumber,
});

const areaPreferenceDiagnosticCodeSchema = z.enum([
  "PREFERENCE_CLAMPED_TO_HARD_CAP",
  "FOOTPRINT_AREA_APPROXIMATED",
  "PREFERRED_FOOTPRINT_NOT_GENERATED",
]);

const footprintAreaPreferenceResultSchema = z.object({
  original_hard_area_upper_bound_m2: positiveNumber,
  requested_area_m2: positiveNumber,
  effective_target_m2: positiveNumber,
  actual_area_m2: positiveNumber.nullable(),
  difference_m2: z.number().nullable(),
  effective_target_undershoot_m2: nonNegativeNumber.nullable(),
  status: z.enum(["met", "clamped", "approximated", "unmet"]),
  diagnostic_codes: z.array(areaPreferenceDiagnosticCodeSchema),
});

const preferenceResultsSchema = z.object({
  preferred_floor_count: positiveInteger.nullable(),
  footprint_area: footprintAreaPreferenceResultSchema.nullable(),
});

const targetDiagnosticCodeSchema = z.enum([
  "TARGET_EXCEEDS_UPPER_BOUND",
  "TARGET_BEYOND_GENERATED_CAPACITY",
  "TARGET_UNMET_WITH_PREFERENCES",
]);

const gfaTargetAssessmentSchema = z.object({
  requested_m2: nonNegativeNumber.nullable(),
  actual_m2: positiveNumber.nullable(),
  shortfall_m2: positiveNumber.nullable(),
  status: z.enum(["not_requested", "met", "unmet", "not_evaluated"]),
  diagnostic_code: targetDiagnosticCodeSchema.nullable(),
});

const diagnosticCodeSchema = z.enum([
  "EMPTY_BUILDABLE_REGION",
  "BUILDABLE_REGION_SPLIT",
  "ZERO_PERMITTED_FLOORS",
  "FOOTPRINT_NOT_GENERATED",
  ...areaPreferenceDiagnosticCodeSchema.options,
  ...targetDiagnosticCodeSchema.options,
]);

const diagnosticValueSchema = z.union([z.number(), z.string(), z.boolean(), z.null()]);
const diagnosticSchema = z.object({
  code: diagnosticCodeSchema,
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  path: z.string().nullable().optional(),
  details: z.record(z.string(), diagnosticValueSchema).nullable().optional(),
});

const feasibilityStatusSchema = z.enum([
  "feasible", "feasible_target_unmet", "infeasible", "generation_failed",
]);

const massingFeasibilitySchema = z.object({
  status: feasibilityStatusSchema,
  reason: z.enum([
    "EMPTY_BUILDABLE_REGION",
    "ZERO_PERMITTED_FLOORS",
    "FOOTPRINT_NOT_GENERATED",
    "PREFERRED_FOOTPRINT_NOT_GENERATED",
  ]).nullable(),
  hard_constraints_satisfied: z.boolean().nullable(),
  target_assessment: gfaTargetAssessmentSchema,
  diagnostics: z.array(diagnosticSchema),
});

export const massingPreviewResponseSchema = massingPreviewRequestSchema.extend({
  site_geometry: polygonGeometrySchema,
  buildable_geometry: z.discriminatedUnion("type", [
    polygonGeometrySchema, multiPolygonGeometrySchema,
  ]).nullable(),
  selected_buildable_geometry: polygonGeometrySchema.nullable(),
  generated_footprint_geometry: polygonGeometrySchema.nullable(),
  footprint_geometry: polygonGeometrySchema.nullable(),
  floor_plate_geometry: polygonGeometrySchema.nullable(),
  metrics: massingMetricsSchema,
  setback: setbackSummarySchema,
  preference_results: preferenceResultsSchema,
  feasibility: massingFeasibilitySchema,
});

// Python limits names by Unicode codepoint count; JavaScript string.length counts UTF-16 units.
export const optionNameSchema = z.string().trim()
  .refine((value) => Array.from(value).length >= 1, "Enter a name or leave the field empty.")
  .refine((value) => Array.from(value).length <= 200, "Use 200 characters or fewer.")
  .refine((value) => !value.includes("\0"), "The name cannot contain a NUL character.");

export const rootOptionRequestSchema = massingPreviewRequestSchema.extend({
  name: optionNameSchema.nullable().optional(),
});

export const optionResponseSchema = z.object({
  id: z.uuid(),
  parent_id: z.uuid().nullable(),
  name: z.string().nullable(),
  schema_version: positiveInteger,
  algorithm_version: z.string().min(1),
  feasibility_status: feasibilityStatusSchema,
  created_at: z.iso.datetime({ offset: true }),
  site_geometry: polygonGeometrySchema,
  hard_constraints: hardConstraintsSchema,
  preferences: designPreferencesSchema,
  targets: designTargetsSchema,
  result: massingPreviewResponseSchema,
}).refine((value) => value.feasibility_status === value.result.feasibility.status);

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })),
  }),
});

export type PolygonGeometry = z.infer<typeof polygonGeometrySchema>;
export type MultiPolygonGeometry = z.infer<typeof multiPolygonGeometrySchema>;
export type HardConstraints = z.input<typeof hardConstraintsSchema>;
export type DesignPreferences = z.input<typeof designPreferencesSchema>;
export type DesignTargets = z.input<typeof designTargetsSchema>;
export type MassingPreviewRequest = z.input<typeof massingPreviewRequestSchema>;
export type MassingPreviewResponse = z.infer<typeof massingPreviewResponseSchema>;
export type RootOptionRequest = z.input<typeof rootOptionRequestSchema>;
export type OptionResponse = z.infer<typeof optionResponseSchema>;
export type MassingMetrics = z.infer<typeof massingMetricsSchema>;
export type SetbackSummary = z.infer<typeof setbackSummarySchema>;
export type FootprintAreaPreferenceResult = z.infer<typeof footprintAreaPreferenceResultSchema>;
export type PreferenceResults = z.infer<typeof preferenceResultsSchema>;
export type GfaTargetAssessment = z.infer<typeof gfaTargetAssessmentSchema>;
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export type FeasibilityStatus = z.infer<typeof feasibilityStatusSchema>;
export type MassingFeasibility = z.infer<typeof massingFeasibilitySchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type ErrorBody = ErrorResponse["error"];
export type ErrorDetail = ErrorBody["details"][number];
