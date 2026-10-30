"""Typed JSON contracts for transient massing previews."""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

type FiniteNumber = Annotated[float, Field(strict=True, allow_inf_nan=False)]
type PositiveNumber = Annotated[FiniteNumber, Field(gt=0)]
type NonNegativeNumber = Annotated[FiniteNumber, Field(ge=0)]
type PositiveInteger = Annotated[int, Field(strict=True, gt=0)]
type NonNegativeInteger = Annotated[int, Field(strict=True, ge=0)]
# Keep integer ordinates intact until domain validation checks exact ring closure.
# Eager float conversion can make distinct large closing coordinates appear equal.
type Coordinate = Annotated[int, Field(strict=True)] | FiniteNumber
type Position = Annotated[list[Coordinate], Field(min_length=2, max_length=2)]
type Ring = Annotated[list[Position], Field(min_length=4)]
type PolygonCoordinates = Annotated[list[Ring], Field(min_length=1)]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PolygonGeometry(ContractModel):
    type: Literal["Polygon"]
    coordinates: PolygonCoordinates


class MultiPolygonGeometry(ContractModel):
    type: Literal["MultiPolygon"]
    coordinates: Annotated[list[PolygonCoordinates], Field(min_length=1)]


class HardConstraints(ContractModel):
    setback_m: NonNegativeNumber
    floor_to_floor_m: PositiveNumber
    max_height_m: PositiveNumber | None = None
    max_floors: PositiveInteger | None = None
    site_coverage_ratio: Annotated[PositiveNumber, Field(le=1)] | None = None
    max_footprint_m2: PositiveNumber | None = None

    @model_validator(mode="after")
    def require_floor_capacity_limit(self) -> Self:
        if self.max_height_m is None and self.max_floors is None:
            raise ValueError("At least one of max_height_m or max_floors is required.")
        return self


class DesignPreferences(ContractModel):
    preferred_floor_count: PositiveInteger | None = None
    preferred_footprint_area_m2: PositiveNumber | None = None


class DesignTargets(ContractModel):
    gfa_target_m2: NonNegativeNumber | None = None


class MassingPreviewRequest(ContractModel):
    site: PolygonGeometry
    hard_constraints: HardConstraints
    preferences: DesignPreferences = Field(default_factory=DesignPreferences)
    targets: DesignTargets = Field(default_factory=DesignTargets)


class MassingMetrics(ContractModel):
    site_area_m2: PositiveNumber
    buildable_area_m2: NonNegativeNumber
    selected_buildable_area_m2: NonNegativeNumber
    footprint_area_upper_bound_m2: NonNegativeNumber
    gfa_upper_bound_m2: NonNegativeNumber
    generated_footprint_area_m2: PositiveNumber | None
    generated_gfa_capacity_m2: PositiveNumber | None
    maximum_permitted_floor_count: NonNegativeInteger
    footprint_area_m2: PositiveNumber | None
    floor_count: PositiveInteger | None
    height_m: PositiveNumber | None
    gfa_m2: PositiveNumber | None
    site_coverage_ratio: NonNegativeNumber | None
    floor_to_floor_m: PositiveNumber


class SetbackSummary(ContractModel):
    component_count: NonNegativeInteger
    retained_area_m2: NonNegativeNumber
    discarded_area_m2: NonNegativeNumber


type AreaPreferenceDiagnosticCode = Literal[
    "PREFERENCE_CLAMPED_TO_HARD_CAP", "FOOTPRINT_AREA_APPROXIMATED", "PREFERRED_FOOTPRINT_NOT_GENERATED"
]


class FootprintAreaPreferenceResult(ContractModel):
    original_hard_area_upper_bound_m2: PositiveNumber
    requested_area_m2: PositiveNumber
    effective_target_m2: PositiveNumber
    actual_area_m2: PositiveNumber | None
    difference_m2: FiniteNumber | None
    effective_target_undershoot_m2: NonNegativeNumber | None
    status: Literal["met", "clamped", "approximated", "unmet"]
    diagnostic_codes: list[AreaPreferenceDiagnosticCode]


class PreferenceResults(ContractModel):
    preferred_floor_count: PositiveInteger | None
    footprint_area: FootprintAreaPreferenceResult | None


type TargetDiagnosticCode = Literal[
    "TARGET_EXCEEDS_UPPER_BOUND", "TARGET_BEYOND_GENERATED_CAPACITY", "TARGET_UNMET_WITH_PREFERENCES"
]


class GfaTargetAssessment(ContractModel):
    requested_m2: NonNegativeNumber | None
    actual_m2: PositiveNumber | None
    shortfall_m2: PositiveNumber | None
    status: Literal["not_requested", "met", "unmet", "not_evaluated"]
    diagnostic_code: TargetDiagnosticCode | None


type DiagnosticCode = (
    Literal[
        "EMPTY_BUILDABLE_REGION",
        "BUILDABLE_REGION_SPLIT",
        "ZERO_PERMITTED_FLOORS",
        "FOOTPRINT_NOT_GENERATED",
    ]
    | AreaPreferenceDiagnosticCode
    | TargetDiagnosticCode
)
type DiagnosticValue = Annotated[int, Field(strict=True)] | FiniteNumber | str | bool | None


class Diagnostic(ContractModel):
    code: DiagnosticCode
    severity: Literal["info", "warning", "error"]
    message: str
    path: str | None = None
    details: dict[str, DiagnosticValue] | None = None


class MassingFeasibility(ContractModel):
    status: Literal["feasible", "feasible_target_unmet", "infeasible", "generation_failed"]
    reason: (
        Literal[
            "EMPTY_BUILDABLE_REGION",
            "ZERO_PERMITTED_FLOORS",
            "FOOTPRINT_NOT_GENERATED",
            "PREFERRED_FOOTPRINT_NOT_GENERATED",
        ]
        | None
    )
    hard_constraints_satisfied: bool | None
    target_assessment: GfaTargetAssessment
    diagnostics: list[Diagnostic]


class MassingPreviewResponse(MassingPreviewRequest):
    site_geometry: PolygonGeometry
    buildable_geometry: Annotated[PolygonGeometry | MultiPolygonGeometry, Field(discriminator="type")] | None
    selected_buildable_geometry: PolygonGeometry | None
    generated_footprint_geometry: PolygonGeometry | None
    footprint_geometry: PolygonGeometry | None
    floor_plate_geometry: PolygonGeometry | None
    metrics: MassingMetrics
    setback: SetbackSummary
    preference_results: PreferenceResults
    feasibility: MassingFeasibility


class ErrorDetail(ContractModel):
    path: str
    message: str


class ErrorBody(ContractModel):
    code: str
    message: str
    details: list[ErrorDetail]


class ErrorResponse(ContractModel):
    error: ErrorBody
