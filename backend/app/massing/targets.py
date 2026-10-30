"""Validated GFA targets and pure target assessment rules."""

from dataclasses import dataclass
from math import isfinite
from typing import Literal

from app.geometry.tolerances import area_tolerance_m2


class InvalidDesignTargets(ValueError):
    """A GFA target does not satisfy the domain contract."""


@dataclass(frozen=True, slots=True)
class DesignTargets:
    """Immutable optional target for the selected building's gross floor area."""

    gfa_target_m2: float | None = None

    def __post_init__(self) -> None:
        target = _finite_non_negative_float(
            self.gfa_target_m2,
            "gfa_target_m2",
            error_type=InvalidDesignTargets,
        )
        object.__setattr__(self, "gfa_target_m2", target)


type GfaTargetStatus = Literal["not_requested", "met", "unmet", "not_evaluated"]
type GfaTargetDiagnosticCode = Literal[
    "TARGET_EXCEEDS_UPPER_BOUND",
    "TARGET_BEYOND_GENERATED_CAPACITY",
    "TARGET_UNMET_WITH_PREFERENCES",
]


@dataclass(frozen=True, slots=True)
class GfaTargetAssessment:
    """Measured target outcome for one selected massing result."""

    gfa_target_m2: float | None
    status: GfaTargetStatus
    shortfall_m2: float | None
    diagnostic_code: GfaTargetDiagnosticCode | None


def gfa_tolerance_m2(
    site_area_m2: float,
    maximum_permitted_floor_count: int,
    *,
    comparison_scale_m2: float,
) -> float:
    """Return a finite, conservative GFA comparison tolerance.

    Area tolerance is propagated through the integer floor capacity without ever
    converting that capacity to ``float``. The result is capped at the same
    scale-relative order as the base area policy so a huge floor count cannot
    turn a material GFA shortfall into a successful target comparison.
    """

    site_area = _finite_positive_float(site_area_m2, "site_area_m2")
    floor_count = _positive_integer(maximum_permitted_floor_count, "maximum_permitted_floor_count")
    if floor_count is None:
        raise ValueError("maximum_permitted_floor_count must be a strictly positive integer.")
    scale = _finite_positive_float(comparison_scale_m2, "comparison_scale_m2")

    base_tolerance = area_tolerance_m2(site_area)
    scale_cap = 1e-9 * scale
    base_numerator, base_denominator = base_tolerance.as_integer_ratio()
    cap_numerator, cap_denominator = scale_cap.as_integer_ratio()

    # Compare the exact rational product with the cap before converting it to a
    # float. This keeps arbitrarily large integer floor limits safe and bounded.
    propagated_numerator = base_numerator * floor_count
    if propagated_numerator * cap_denominator > cap_numerator * base_denominator:
        return scale_cap
    propagated = propagated_numerator / base_denominator
    if not isfinite(propagated):
        return scale_cap
    return min(propagated, scale_cap)


def assess_gfa_target(
    targets: DesignTargets,
    *,
    actual_gfa_m2: float | None,
    gfa_upper_bound_m2: float | None = None,
    generated_gfa_capacity_m2: float | None = None,
    site_area_m2: float | None = None,
    maximum_permitted_floor_count: int | None = None,
) -> GfaTargetAssessment:
    """Assess a target against measured GFA and preserved massing bounds.

    A missing actual GFA means that no valid building is available for target
    evaluation. In that case the target remains ``not_evaluated`` and no target
    diagnostic is inferred from missing geometry or capacity.
    """

    if not isinstance(targets, DesignTargets):
        raise TypeError("targets must be a DesignTargets instance.")

    target = targets.gfa_target_m2
    if target is None:
        return GfaTargetAssessment(None, "not_requested", None, None)
    if actual_gfa_m2 is None:
        return GfaTargetAssessment(target, "not_evaluated", None, None)

    actual = _finite_positive_float(actual_gfa_m2, "actual_gfa_m2")
    upper_bound = _finite_non_negative_float(gfa_upper_bound_m2, "gfa_upper_bound_m2")
    if upper_bound is None:
        raise ValueError("gfa_upper_bound_m2 is required when actual_gfa_m2 is available.")
    generated_capacity = _finite_non_negative_float(
        generated_gfa_capacity_m2,
        "generated_gfa_capacity_m2",
        allow_none=True,
    )
    site_area = _finite_positive_float(site_area_m2, "site_area_m2")
    if site_area is None:
        raise ValueError("site_area_m2 is required when actual_gfa_m2 is available.")
    floor_count = _positive_integer(maximum_permitted_floor_count, "maximum_permitted_floor_count")
    if floor_count is None:
        raise ValueError("maximum_permitted_floor_count is required when actual_gfa_m2 is available.")

    if actual > upper_bound:
        raise ValueError("actual_gfa_m2 cannot exceed gfa_upper_bound_m2.")
    if generated_capacity is not None and generated_capacity > upper_bound:
        raise ValueError("generated_gfa_capacity_m2 cannot exceed gfa_upper_bound_m2.")

    comparison_scale = max(target, actual)
    tolerance = gfa_tolerance_m2(
        site_area,
        floor_count,
        comparison_scale_m2=comparison_scale,
    )
    shortfall = target - actual
    if is_gfa_target_met(
        targets,
        actual_gfa_m2=actual,
        site_area_m2=site_area,
        maximum_permitted_floor_count=floor_count,
    ):
        return GfaTargetAssessment(target, "met", None, None)

    if target - upper_bound > tolerance:
        diagnostic_code: GfaTargetDiagnosticCode | None = "TARGET_EXCEEDS_UPPER_BOUND"
    elif generated_capacity is not None and target - generated_capacity > tolerance:
        diagnostic_code = "TARGET_BEYOND_GENERATED_CAPACITY"
    else:
        diagnostic_code = "TARGET_UNMET_WITH_PREFERENCES" if generated_capacity is not None else None

    if not isfinite(shortfall) or shortfall <= 0:
        raise RuntimeError("Unmet GFA target must have a finite positive shortfall.")
    return GfaTargetAssessment(target, "unmet", shortfall, diagnostic_code)


def is_gfa_target_met(
    targets: DesignTargets,
    *,
    actual_gfa_m2: float,
    site_area_m2: float,
    maximum_permitted_floor_count: int,
) -> bool:
    """Return whether measured GFA fulfills the validated target predicate."""

    if not isinstance(targets, DesignTargets):
        raise TypeError("targets must be a DesignTargets instance.")
    if targets.gfa_target_m2 is None:
        return True

    actual = _finite_positive_float(actual_gfa_m2, "actual_gfa_m2")
    site_area = _finite_positive_float(site_area_m2, "site_area_m2")
    floor_count = _positive_integer(maximum_permitted_floor_count, "maximum_permitted_floor_count")
    if floor_count is None:
        raise ValueError("maximum_permitted_floor_count must be a strictly positive integer.")

    target = targets.gfa_target_m2
    assert target is not None
    tolerance = gfa_tolerance_m2(
        site_area,
        floor_count,
        comparison_scale_m2=max(target, actual),
    )
    return target - actual <= tolerance


def _finite_non_negative_float(
    value: object,
    field_name: str,
    *,
    allow_none: bool = True,
    error_type: type[ValueError] = ValueError,
) -> float | None:
    if value is None:
        if allow_none:
            return None
        raise error_type(f"{field_name} must be a finite non-negative number.")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise error_type(f"{field_name} must be a finite non-negative number.")
    try:
        converted = float(value)
    except OverflowError as error:
        raise error_type(f"{field_name} must be representable as a finite float.") from error
    if not isfinite(converted) or converted < 0:
        raise error_type(f"{field_name} must be a finite non-negative number.")
    return converted


def _finite_positive_float(value: object, field_name: str) -> float:
    converted = _finite_non_negative_float(value, field_name, allow_none=True)
    if converted is None or converted <= 0:
        raise ValueError(f"{field_name} must be a finite positive number.")
    return converted


def _positive_integer(value: object, field_name: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{field_name} must be a strictly positive integer.")
    return value
