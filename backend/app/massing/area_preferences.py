"""Preferred footprint-area construction over the deterministic default generator."""

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
from app.geometry.setbacks import SetbackResult
from app.geometry.tolerances import area_tolerance_m2
from app.massing.preferences import DesignPreferences, InvalidDesignPreferences

type FootprintAreaPreferenceStatus = Literal["met", "clamped", "approximated", "unmet"]
type FootprintAreaPreferenceDiagnosticCode = Literal[
    "PREFERENCE_CLAMPED_TO_HARD_CAP",
    "FOOTPRINT_AREA_APPROXIMATED",
    "PREFERRED_FOOTPRINT_NOT_GENERATED",
]


@dataclass(frozen=True, slots=True)
class FootprintAreaPreferenceResult:
    """Measured result of applying one validated preferred footprint area."""

    original_hard_area_upper_bound_m2: float
    requested_area_m2: float
    effective_target_m2: float
    actual_area_m2: float | None
    difference_m2: float | None
    effective_target_undershoot_m2: float | None
    status: FootprintAreaPreferenceStatus
    footprint_result: FootprintResult
    diagnostic_codes: tuple[FootprintAreaPreferenceDiagnosticCode, ...]


def generate_preferred_footprint(
    setback: SetbackResult,
    hard_limits: FootprintLimits,
    preferences: DesignPreferences,
) -> FootprintAreaPreferenceResult | None:
    """Construct a preferred area from the original selected buildable component."""
    if not isinstance(preferences, DesignPreferences):
        raise InvalidDesignPreferences("preferences must be a DesignPreferences instance.")
    if not isinstance(setback, SetbackResult):
        raise TypeError("setback must be a SetbackResult instance.")
    if not isinstance(hard_limits, FootprintLimits):
        raise TypeError("hard_limits must be a FootprintLimits instance.")

    requested = preferences.preferred_footprint_area_m2
    if requested is None:
        return None

    selected = setback.selected_buildable_geometry
    if selected is None:
        raise ValueError("Preferred footprint construction requires a positive selected buildable region.")
    if not isinstance(selected, Polygon) or not selected.is_valid:
        raise RuntimeError("Selected buildable geometry must be a valid Polygon.")
    if selected.is_empty:
        raise ValueError("Preferred footprint construction requires a positive selected buildable region.")
    selected_area = float(selected.area)
    if not isfinite(selected_area) or selected_area <= 0:
        raise RuntimeError("Selected buildable geometry must have finite positive area.")
    if not isfinite(setback.site_area_m2) or setback.site_area_m2 <= 0:
        raise RuntimeError("Setback result must have finite positive site area.")

    original_upper_bound = calculate_footprint_area_upper_bound(setback, hard_limits)
    if not isfinite(original_upper_bound) or original_upper_bound <= 0:
        raise ValueError("Preferred footprint construction requires a positive hard area upper bound.")

    effective_target = min(requested, original_upper_bound)
    if not isfinite(effective_target) or effective_target <= 0:
        raise RuntimeError("Preferred footprint construction target must be finite and positive.")

    # The derived cap changes only the construction target. The original limits remain
    # authoritative through the bounded target and the strict result invariant checks.
    footprint_result = generate_footprint(
        setback,
        FootprintLimits(max_footprint_area_m2=effective_target),
    )
    if not isinstance(footprint_result, FootprintResult):
        raise RuntimeError("Preferred footprint construction must return a FootprintResult.")
    if footprint_result.outcome == "generation_failed":
        return FootprintAreaPreferenceResult(
            original_hard_area_upper_bound_m2=original_upper_bound,
            requested_area_m2=requested,
            effective_target_m2=effective_target,
            actual_area_m2=None,
            difference_m2=None,
            effective_target_undershoot_m2=None,
            status="unmet",
            footprint_result=footprint_result,
            diagnostic_codes=("PREFERRED_FOOTPRINT_NOT_GENERATED",),
        )
    if footprint_result.outcome != "success":
        raise RuntimeError("Positive preferred footprint context produced an unexpected empty outcome.")

    geometry = footprint_result.generated_footprint_geometry
    reported_area = footprint_result.generated_footprint_area_m2
    if geometry is None or reported_area is None:
        raise RuntimeError("Successful preferred footprint construction must include geometry and measured area.")
    if not isinstance(geometry, Polygon) or geometry.is_empty or not geometry.is_valid:
        raise RuntimeError("Generated preferred footprint must be a valid non-empty Polygon.")
    if not selected.covers(geometry):
        raise RuntimeError("Generated preferred footprint extends outside the selected buildable component.")

    actual_area = float(geometry.area)
    tolerance = area_tolerance_m2(setback.site_area_m2)
    if not isfinite(actual_area) or actual_area <= 0:
        raise RuntimeError("Generated preferred footprint must have finite positive area.")
    if not isfinite(reported_area) or reported_area <= 0:
        raise RuntimeError("Generated preferred footprint area must have finite positive area.")
    if abs(reported_area - actual_area) > tolerance:
        raise RuntimeError("Generated preferred footprint and reported areas disagree.")
    if actual_area > effective_target or actual_area > original_upper_bound:
        raise RuntimeError("Generated preferred footprint exceeds its hard area bound.")

    difference = actual_area - requested
    effective_target_undershoot = effective_target - actual_area
    if effective_target_undershoot < 0:
        raise RuntimeError("Generated preferred footprint has a negative effective-target undershoot.")

    materially_clamped = requested - original_upper_bound > tolerance
    if materially_clamped:
        diagnostic_codes: tuple[FootprintAreaPreferenceDiagnosticCode, ...]
        if effective_target_undershoot > tolerance:
            diagnostic_codes = (
                "PREFERENCE_CLAMPED_TO_HARD_CAP",
                "FOOTPRINT_AREA_APPROXIMATED",
            )
        else:
            diagnostic_codes = ("PREFERENCE_CLAMPED_TO_HARD_CAP",)
        status: FootprintAreaPreferenceStatus = "clamped"
    elif abs(difference) <= tolerance:
        diagnostic_codes = ()
        status = "met"
    else:
        diagnostic_codes = ("FOOTPRINT_AREA_APPROXIMATED",)
        status = "approximated"

    return FootprintAreaPreferenceResult(
        original_hard_area_upper_bound_m2=original_upper_bound,
        requested_area_m2=requested,
        effective_target_m2=effective_target,
        actual_area_m2=actual_area,
        difference_m2=difference,
        effective_target_undershoot_m2=effective_target_undershoot if materially_clamped else None,
        status=status,
        footprint_result=footprint_result,
        diagnostic_codes=diagnostic_codes,
    )
