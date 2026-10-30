"""Pure target-driven floor-count selection."""

from math import isfinite

from app.massing.metrics import NumericalRangeError, multiply_metric
from app.massing.preferences import DesignPreferences, select_floor_count
from app.massing.targets import DesignTargets, is_gfa_target_met


def select_floor_count_for_target(
    maximum_permitted_floor_count: int,
    preferences: DesignPreferences,
    targets: DesignTargets,
    *,
    footprint_area_m2: float,
    site_area_m2: float,
) -> int | None:
    """Select the smallest permitted count that fulfills a positive GFA target.

    The footprint area is the measured selected floor plate. Explicit floor
    preferences and the existing zero-capacity behavior take precedence over
    target arithmetic. The positive-target path searches a monotonic scalar
    predicate with integer bisection, so large capacities never become a
    linear iteration.
    """

    if not isinstance(targets, DesignTargets):
        raise TypeError("targets must be a DesignTargets instance.")

    selected = select_floor_count(maximum_permitted_floor_count, preferences)
    if selected is None:
        return None
    if preferences.preferred_floor_count is not None:
        return selected

    target = targets.gfa_target_m2
    if target is None or target == 0:
        return selected

    footprint_area = _finite_positive_float(footprint_area_m2, "footprint_area_m2")
    site_area = _finite_positive_float(site_area_m2, "site_area_m2")
    maximum = selected
    strict_upper = min(maximum, _strict_minimum_floor_count(target, footprint_area))

    def satisfies(floor_count: int) -> bool:
        try:
            actual_gfa = multiply_metric(
                footprint_area,
                floor_count,
                metric_name="actual_gfa_m2",
            )
        except NumericalRangeError:
            # A finite target is necessarily below an unrepresentable positive
            # product. Keep the search monotonic; the selected result is checked
            # again below so the established range-error contract is preserved.
            return True
        return is_gfa_target_met(
            targets,
            actual_gfa_m2=actual_gfa,
            site_area_m2=site_area,
            maximum_permitted_floor_count=maximum,
        )

    if not satisfies(strict_upper):
        if strict_upper == maximum:
            actual_gfa = multiply_metric(footprint_area, maximum, metric_name="actual_gfa_m2")
            if not is_gfa_target_met(
                targets,
                actual_gfa_m2=actual_gfa,
                site_area_m2=site_area,
                maximum_permitted_floor_count=maximum,
            ):
                return maximum
        strict_upper = maximum

    low = 1
    high = strict_upper
    while low < high:
        midpoint = low + (high - low) // 2
        if satisfies(midpoint):
            high = midpoint
        else:
            low = midpoint + 1

    selected = low
    actual_gfa = multiply_metric(footprint_area, selected, metric_name="actual_gfa_m2")
    if not is_gfa_target_met(
        targets,
        actual_gfa_m2=actual_gfa,
        site_area_m2=site_area,
        maximum_permitted_floor_count=maximum,
    ):
        raise RuntimeError("Target floor selection returned an insufficient floor count.")
    if selected > 1:
        previous_gfa = multiply_metric(footprint_area, selected - 1, metric_name="actual_gfa_m2")
        if is_gfa_target_met(
            targets,
            actual_gfa_m2=previous_gfa,
            site_area_m2=site_area,
            maximum_permitted_floor_count=maximum,
        ):
            raise RuntimeError("Target floor selection returned a non-minimal floor count.")
    return selected


def _strict_minimum_floor_count(target: float, footprint_area: float) -> int:
    target_numerator, target_denominator = target.as_integer_ratio()
    area_numerator, area_denominator = footprint_area.as_integer_ratio()
    numerator = target_numerator * area_denominator
    denominator = target_denominator * area_numerator
    return (numerator + denominator - 1) // denominator


def _finite_positive_float(value: object, field_name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field_name} must be a finite positive number.")
    try:
        converted = float(value)
    except OverflowError as error:
        raise ValueError(f"{field_name} must be representable as a finite float.") from error
    if not isfinite(converted) or converted <= 0:
        raise ValueError(f"{field_name} must be a finite positive number.")
    return converted
