"""Default massing orchestration over the validated geometry operations."""

from dataclasses import dataclass
from math import isfinite
from typing import Literal

from shapely.geometry import Polygon

from app.geometry.footprints import (
    FootprintLimits,
    FootprintResult,
    calculate_footprint_area_upper_bound,
    generate_footprint,
)
from app.geometry.setbacks import SetbackResult, calculate_setback
from app.geometry.site import normalize_polygon
from app.massing.floors import FloorLimits, calculate_maximum_permitted_floor_count
from app.massing.metrics import NumericalRangeError
from app.massing.metrics import multiply_metric as _multiply_metric

type DefaultMassingStatus = Literal["feasible", "infeasible", "generation_failed"]
type DefaultMassingReason = Literal[
    "EMPTY_BUILDABLE_REGION",
    "ZERO_PERMITTED_FLOORS",
    "FOOTPRINT_NOT_GENERATED",
]


@dataclass(frozen=True, slots=True)
class DefaultMassingResult:
    """Immutable context, construction, metrics, and outcome for default massing."""

    site_geometry: Polygon
    setback_result: SetbackResult
    footprint_result: FootprintResult | None
    floor_to_floor_m: float
    maximum_permitted_floor_count: int
    footprint_area_upper_bound_m2: float
    gfa_upper_bound_m2: float
    generated_footprint_geometry: Polygon | None
    generated_footprint_area_m2: float | None
    generated_gfa_capacity_m2: float | None
    footprint_geometry: Polygon | None
    floor_plate_geometry: Polygon | None
    footprint_area_m2: float | None
    floor_count: int | None
    height_m: float | None
    gfa_m2: float | None
    site_coverage_ratio: float | None
    status: DefaultMassingStatus
    hard_constraints_satisfied: bool | None
    reason: DefaultMassingReason | None


def generate_default_massing(
    site: Polygon,
    *,
    setback_m: float,
    footprint_limits: FootprintLimits,
    floor_limits: FloorLimits,
) -> DefaultMassingResult:
    """Assemble one default building from validated site and hard-limit operations."""
    canonical_site = normalize_polygon(site)
    setback_result = calculate_setback(canonical_site, setback_m)
    maximum_floor_count = calculate_maximum_permitted_floor_count(floor_limits)
    footprint_upper_bound = calculate_footprint_area_upper_bound(setback_result, footprint_limits)
    gfa_upper_bound = _multiply_metric(
        footprint_upper_bound,
        maximum_floor_count,
        metric_name="gfa_upper_bound_m2",
    )

    # Report the missing selected region when both geometry and floor limits block construction.
    if setback_result.selected_buildable_geometry is None or setback_result.selected_buildable_geometry.is_empty:
        return _without_building(
            canonical_site,
            setback_result,
            floor_limits,
            maximum_floor_count,
            footprint_upper_bound,
            gfa_upper_bound,
            status="infeasible",
            reason="EMPTY_BUILDABLE_REGION",
        )
    if maximum_floor_count == 0:
        return _without_building(
            canonical_site,
            setback_result,
            floor_limits,
            maximum_floor_count,
            footprint_upper_bound,
            gfa_upper_bound,
            status="infeasible",
            reason="ZERO_PERMITTED_FLOORS",
        )

    coverage_limit = footprint_limits.site_coverage_ratio
    # Positive inputs can round their product to zero. Keep known infeasibility
    # above, but never interpret an unrepresentable cap as failed construction.
    if coverage_limit is not None and setback_result.site_area_m2 * coverage_limit == 0:
        raise NumericalRangeError(
            "Site area multiplied by site_coverage_ratio must be representable as a positive float."
        )

    footprint_result = generate_footprint(setback_result, footprint_limits)
    if footprint_result.outcome == "generation_failed":
        return _without_building(
            canonical_site,
            setback_result,
            floor_limits,
            maximum_floor_count,
            footprint_upper_bound,
            gfa_upper_bound,
            footprint_result=footprint_result,
            status="generation_failed",
            reason="FOOTPRINT_NOT_GENERATED",
        )
    if footprint_result.outcome != "success":
        raise RuntimeError("Positive buildable geometry produced an unexpected empty footprint outcome.")

    generated_geometry = footprint_result.generated_footprint_geometry
    generated_area = footprint_result.generated_footprint_area_m2
    if generated_geometry is None or generated_area is None:
        raise RuntimeError("Successful footprint construction must include geometry and measured area.")
    actual_area = float(generated_geometry.area)
    if not isfinite(actual_area) or actual_area <= 0:
        raise RuntimeError("Generated footprint geometry must have finite positive area.")

    generated_capacity = _multiply_metric(
        generated_area,
        maximum_floor_count,
        metric_name="generated_gfa_capacity_m2",
    )
    height = _multiply_metric(
        floor_limits.floor_to_floor_m,
        maximum_floor_count,
        metric_name="height_m",
    )
    gfa = _multiply_metric(actual_area, maximum_floor_count, metric_name="gfa_m2")
    coverage = actual_area / setback_result.site_area_m2
    if not isfinite(coverage):
        raise NumericalRangeError("site_coverage_ratio must be representable as a finite float.")

    return DefaultMassingResult(
        site_geometry=canonical_site,
        setback_result=setback_result,
        footprint_result=footprint_result,
        floor_to_floor_m=floor_limits.floor_to_floor_m,
        maximum_permitted_floor_count=maximum_floor_count,
        footprint_area_upper_bound_m2=footprint_upper_bound,
        gfa_upper_bound_m2=gfa_upper_bound,
        generated_footprint_geometry=generated_geometry,
        generated_footprint_area_m2=generated_area,
        generated_gfa_capacity_m2=generated_capacity,
        footprint_geometry=generated_geometry,
        floor_plate_geometry=generated_geometry,
        footprint_area_m2=actual_area,
        floor_count=maximum_floor_count,
        height_m=height,
        gfa_m2=gfa,
        site_coverage_ratio=coverage,
        status="feasible",
        hard_constraints_satisfied=True,
        reason=None,
    )


def _without_building(
    site_geometry: Polygon,
    setback_result: SetbackResult,
    floor_limits: FloorLimits,
    maximum_floor_count: int,
    footprint_upper_bound: float,
    gfa_upper_bound: float,
    *,
    status: DefaultMassingStatus,
    reason: DefaultMassingReason,
    footprint_result: FootprintResult | None = None,
) -> DefaultMassingResult:
    return DefaultMassingResult(
        site_geometry=site_geometry,
        setback_result=setback_result,
        footprint_result=footprint_result,
        floor_to_floor_m=floor_limits.floor_to_floor_m,
        maximum_permitted_floor_count=maximum_floor_count,
        footprint_area_upper_bound_m2=footprint_upper_bound,
        gfa_upper_bound_m2=gfa_upper_bound,
        generated_footprint_geometry=None,
        generated_footprint_area_m2=None,
        generated_gfa_capacity_m2=None,
        footprint_geometry=None,
        floor_plate_geometry=None,
        footprint_area_m2=None,
        floor_count=None,
        height_m=None,
        gfa_m2=None,
        site_coverage_ratio=None,
        status=status,
        hard_constraints_satisfied=False if status == "infeasible" else None,
        reason=reason,
    )
