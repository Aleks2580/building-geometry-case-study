"""Preference-aware massing orchestration over the pure domain operations."""

from dataclasses import dataclass
from math import isfinite
from typing import Literal

from shapely.geometry import Polygon

from app.geometry.footprints import FootprintLimits
from app.geometry.tolerances import area_tolerance_m2
from app.massing.area_preferences import FootprintAreaPreferenceResult, generate_preferred_footprint
from app.massing.defaults import DefaultMassingResult, generate_default_massing
from app.massing.floors import FloorLimits
from app.massing.metrics import NumericalRangeError, multiply_metric
from app.massing.preferences import (
    DesignPreferences,
    InvalidDesignPreferences,
    select_floor_count,
)

type PreferenceMassingStatus = Literal["feasible", "infeasible", "generation_failed"]
type PreferenceMassingReason = Literal[
    "EMPTY_BUILDABLE_REGION",
    "ZERO_PERMITTED_FLOORS",
    "FOOTPRINT_NOT_GENERATED",
    "PREFERRED_FOOTPRINT_NOT_GENERATED",
]


@dataclass(frozen=True, slots=True)
class PreferenceMassingResult:
    """Immutable default context and selected preference-aware building."""

    default_result: DefaultMassingResult
    preferences: DesignPreferences
    area_preference_result: FootprintAreaPreferenceResult | None
    footprint_geometry: Polygon | None
    floor_plate_geometry: Polygon | None
    footprint_area_m2: float | None
    floor_count: int | None
    height_m: float | None
    gfa_m2: float | None
    site_coverage_ratio: float | None
    status: PreferenceMassingStatus
    reason: PreferenceMassingReason | None
    hard_constraints_satisfied: bool | None


def generate_massing_with_preferences(
    site: Polygon,
    *,
    setback_m: float,
    footprint_limits: FootprintLimits,
    floor_limits: FloorLimits,
    preferences: DesignPreferences,
) -> PreferenceMassingResult:
    """Generate one building using validated floor and footprint preferences."""
    if not isinstance(preferences, DesignPreferences):
        raise InvalidDesignPreferences("preferences must be a DesignPreferences instance.")

    default_result = generate_default_massing(
        site,
        setback_m=setback_m,
        footprint_limits=footprint_limits,
        floor_limits=floor_limits,
    )

    # Default orchestration establishes empty-region and zero-floor precedence.
    if default_result.status == "infeasible":
        return _without_building(
            default_result,
            preferences,
            status=default_result.status,
            reason=default_result.reason,
        )

    selected_floor_count = select_floor_count(default_result.maximum_permitted_floor_count, preferences)
    if selected_floor_count is None:
        raise RuntimeError("Positive massing capacity must select a positive floor count.")

    if default_result.status == "generation_failed" and preferences.preferred_footprint_area_m2 is None:
        return _without_building(
            default_result,
            preferences,
            status=default_result.status,
            reason=default_result.reason,
        )

    area_preference_result = None
    if preferences.preferred_footprint_area_m2 is not None:
        area_preference_result = generate_preferred_footprint(
            default_result.setback_result,
            footprint_limits,
            preferences,
        )
        if area_preference_result is None:
            raise RuntimeError("An area preference must produce a preference result.")
        if area_preference_result.status == "unmet":
            return _without_building(
                default_result,
                preferences,
                area_preference_result=area_preference_result,
                status="generation_failed",
                reason="PREFERRED_FOOTPRINT_NOT_GENERATED",
            )

    geometry, actual_area = _selected_footprint(default_result, area_preference_result)
    height = multiply_metric(
        default_result.floor_to_floor_m,
        selected_floor_count,
        metric_name="height_m",
    )
    gfa = multiply_metric(actual_area, selected_floor_count, metric_name="gfa_m2")
    coverage = actual_area / default_result.setback_result.site_area_m2
    if not isfinite(coverage):
        raise NumericalRangeError("site_coverage_ratio must be representable as a finite float.")

    return PreferenceMassingResult(
        default_result=default_result,
        preferences=preferences,
        area_preference_result=area_preference_result,
        footprint_geometry=geometry,
        floor_plate_geometry=geometry,
        footprint_area_m2=actual_area,
        floor_count=selected_floor_count,
        height_m=height,
        gfa_m2=gfa,
        site_coverage_ratio=coverage,
        status="feasible",
        reason=None,
        hard_constraints_satisfied=True,
    )


def _selected_footprint(
    default_result: DefaultMassingResult,
    area_preference_result: FootprintAreaPreferenceResult | None,
) -> tuple[Polygon, float]:
    if area_preference_result is None:
        geometry = default_result.footprint_geometry
        actual_area = default_result.footprint_area_m2
    else:
        geometry = area_preference_result.footprint_result.generated_footprint_geometry
        actual_area = area_preference_result.actual_area_m2

    if geometry is None or actual_area is None:
        raise RuntimeError("A feasible massing result must include footprint geometry and area.")
    if not isinstance(geometry, Polygon) or geometry.is_empty or not geometry.is_valid:
        raise RuntimeError("A feasible massing result must include a valid non-empty footprint Polygon.")
    measured_area = float(geometry.area)
    if not isfinite(measured_area) or measured_area <= 0:
        raise RuntimeError("A feasible massing footprint must have finite positive area.")
    if not isfinite(actual_area) or actual_area <= 0:
        raise RuntimeError("A feasible massing footprint area must be finite and positive.")
    if abs(measured_area - actual_area) > area_tolerance_m2(default_result.setback_result.site_area_m2):
        raise RuntimeError("A feasible massing footprint and area disagree.")
    return geometry, measured_area


def _without_building(
    default_result: DefaultMassingResult,
    preferences: DesignPreferences,
    *,
    status: PreferenceMassingStatus,
    reason: PreferenceMassingReason | None,
    area_preference_result: FootprintAreaPreferenceResult | None = None,
) -> PreferenceMassingResult:
    return PreferenceMassingResult(
        default_result=default_result,
        preferences=preferences,
        area_preference_result=area_preference_result,
        footprint_geometry=None,
        floor_plate_geometry=None,
        footprint_area_m2=None,
        floor_count=None,
        height_m=None,
        gfa_m2=None,
        site_coverage_ratio=None,
        status=status,
        reason=reason,
        hard_constraints_satisfied=False if status == "infeasible" else None,
    )
