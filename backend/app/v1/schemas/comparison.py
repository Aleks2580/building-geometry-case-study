"""Side-by-side contracts for two stored option snapshots."""

from typing import Annotated, Self
from uuid import UUID

from pydantic import Field, model_validator

from app.persistence.options import FeasibilityStatus
from app.v1.schemas.massing import ContractModel, Diagnostic, FiniteNumber, GfaTargetAssessment, PolygonGeometry
from app.v1.schemas.options import OptionResponse

type ComparisonNumber = Annotated[int, Field(strict=True)] | FiniteNumber | None


class OptionComparisonRequest(ContractModel):
    option_ids: tuple[UUID, UUID] = Field(
        description="Exactly two distinct saved UUIDs, in left-to-right comparison order.",
        examples=[["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"]],
    )

    @model_validator(mode="after")
    def require_distinct_options(self) -> Self:
        if self.option_ids[0] == self.option_ids[1]:
            raise ValueError("Select exactly two distinct saved option UUIDs.")
        return self


class ValueComparison[T](ContractModel):
    left: T
    right: T
    changed: bool


class NumericComparison(ValueComparison[ComparisonNumber]):
    difference: ComparisonNumber = Field(description="Right minus left; null when either value is missing.")


class HardConstraintsComparison(ContractModel):
    setback_m: NumericComparison
    floor_to_floor_m: NumericComparison
    max_height_m: NumericComparison
    max_floors: NumericComparison
    site_coverage_ratio: NumericComparison
    max_footprint_m2: NumericComparison


class PreferencesComparison(ContractModel):
    preferred_floor_count: NumericComparison
    preferred_footprint_area_m2: NumericComparison


class TargetsComparison(ContractModel):
    gfa_target_m2: NumericComparison


class InputsComparison(ContractModel):
    site_geometry: ValueComparison[PolygonGeometry]
    hard_constraints: HardConstraintsComparison
    preferences: PreferencesComparison
    targets: TargetsComparison


class MetricsComparison(ContractModel):
    site_area_m2: NumericComparison
    buildable_area_m2: NumericComparison
    selected_buildable_area_m2: NumericComparison
    footprint_area_upper_bound_m2: NumericComparison
    gfa_upper_bound_m2: NumericComparison
    generated_footprint_area_m2: NumericComparison
    generated_gfa_capacity_m2: NumericComparison
    maximum_permitted_floor_count: NumericComparison
    footprint_area_m2: NumericComparison
    floor_count: NumericComparison
    height_m: NumericComparison
    gfa_m2: NumericComparison
    site_coverage_ratio: NumericComparison
    floor_to_floor_m: NumericComparison


class FeasibilityComparison(ContractModel):
    status: ValueComparison[FeasibilityStatus]
    reason: ValueComparison[str | None]
    hard_constraints_satisfied: ValueComparison[bool | None]
    target_assessment: ValueComparison[GfaTargetAssessment]


class OptionComparisonResponse(ContractModel):
    options: tuple[OptionResponse, OptionResponse]
    inputs: InputsComparison
    metrics: MetricsComparison
    feasibility: FeasibilityComparison
    diagnostics: ValueComparison[list[Diagnostic]]
