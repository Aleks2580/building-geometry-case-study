import math

import pytest

from app.massing import (
    DesignPreferences,
    DesignTargets,
    FloorLimits,
    InvalidDesignPreferences,
    NumericalRangeError,
    PreferenceExceedsHardLimit,
    assess_gfa_target,
    calculate_maximum_permitted_floor_count,
    gfa_tolerance_m2,
    is_gfa_target_met,
    select_floor_count_for_target,
)
from app.massing.metrics import multiply_metric


def _select(
    maximum: int,
    preferences: DesignPreferences,
    target: float | None,
    *,
    footprint_area: float = 400.0,
    site_area: float = 1_000.0,
) -> int | None:
    return select_floor_count_for_target(
        maximum,
        preferences,
        DesignTargets(target),
        footprint_area_m2=footprint_area,
        site_area_m2=site_area,
    )


def test_absent_target_uses_existing_default_or_explicit_preference() -> None:
    assert _select(6, DesignPreferences(), None) == 6
    assert _select(6, DesignPreferences(preferred_floor_count=4), None) == 4


def test_zero_target_uses_existing_default_or_explicit_preference() -> None:
    assert _select(6, DesignPreferences(), 0) == 6
    assert _select(6, DesignPreferences(preferred_floor_count=4), 0) == 4


def test_positive_attainable_target_selects_minimum_sufficient_count() -> None:
    selected = _select(6, DesignPreferences(), 1_500)

    assert selected == 4
    assert is_gfa_target_met(
        DesignTargets(1_500),
        actual_gfa_m2=400 * selected,
        site_area_m2=1_000,
        maximum_permitted_floor_count=6,
    )
    assert not is_gfa_target_met(
        DesignTargets(1_500),
        actual_gfa_m2=400 * (selected - 1),
        site_area_m2=1_000,
        maximum_permitted_floor_count=6,
    )


def test_exact_target_boundary_selects_three_floors() -> None:
    selected = _select(6, DesignPreferences(), 1_200)

    assert selected == 3
    assert not is_gfa_target_met(
        DesignTargets(1_200),
        actual_gfa_m2=400 * (selected - 1),
        site_area_m2=1_000,
        maximum_permitted_floor_count=6,
    )


def test_unattainable_target_returns_hard_capacity() -> None:
    assert _select(6, DesignPreferences(), 3_000) == 6


def test_explicit_floor_preference_wins_over_target_selection() -> None:
    assert _select(6, DesignPreferences(preferred_floor_count=2), 3_000) == 2
    assert _select(6, DesignPreferences(preferred_floor_count=6), 1_500) == 6

    with pytest.raises(PreferenceExceedsHardLimit):
        _select(6, DesignPreferences(preferred_floor_count=7), 1_500)


def test_zero_capacity_preserves_existing_semantics_without_target_arithmetic() -> None:
    assert (
        select_floor_count_for_target(
            0,
            DesignPreferences(preferred_floor_count=1),
            DesignTargets(1_500),
            footprint_area_m2=0,
            site_area_m2=0,
        )
        is None
    )


def test_exact_height_boundary_never_adds_a_floor() -> None:
    maximum = calculate_maximum_permitted_floor_count(FloorLimits(3.6, max_height_m=36.0))

    assert maximum == 9
    assert _select(maximum, DesignPreferences(), 3_600, footprint_area=400) == 9
    assert _select(maximum, DesignPreferences(), 4_000, footprint_area=400) == 9
    with pytest.raises(PreferenceExceedsHardLimit):
        _select(maximum, DesignPreferences(preferred_floor_count=10), 1_500)


def test_tolerance_boundary_matches_assessment_and_changes_minimum_count() -> None:
    actual_at_three = 1_200.0
    tolerance = gfa_tolerance_m2(1_000.0, 6, comparison_scale_m2=actual_at_three)
    boundary = actual_at_three + tolerance
    target_inside = math.nextafter(boundary, -math.inf)
    target_outside = math.nextafter(boundary, math.inf)

    assert _select(6, DesignPreferences(), target_inside) == 3
    assert _select(6, DesignPreferences(), target_outside) == 4

    assessed_inside = assess_gfa_target(
        DesignTargets(target_inside),
        actual_gfa_m2=actual_at_three,
        gfa_upper_bound_m2=2_400,
        generated_gfa_capacity_m2=2_400,
        site_area_m2=1_000,
        maximum_permitted_floor_count=6,
    )
    assessed_outside = assess_gfa_target(
        DesignTargets(target_outside),
        actual_gfa_m2=actual_at_three,
        gfa_upper_bound_m2=2_400,
        generated_gfa_capacity_m2=2_400,
        site_area_m2=1_000,
        maximum_permitted_floor_count=6,
    )
    assert assessed_inside.status == "met"
    assert assessed_outside.status == "unmet"


def test_large_integer_capacity_is_searched_without_float_conversion() -> None:
    maximum = 10**400
    selected = _select(
        maximum,
        DesignPreferences(),
        1.0,
        footprint_area=1e-160,
        site_area=1.0,
    )

    assert selected is not None
    assert 0 < selected < maximum
    assert is_gfa_target_met(
        DesignTargets(1.0),
        actual_gfa_m2=multiply_metric(1e-160, selected, metric_name="actual_gfa_m2"),
        site_area_m2=1.0,
        maximum_permitted_floor_count=maximum,
    )
    assert not is_gfa_target_met(
        DesignTargets(1.0),
        actual_gfa_m2=multiply_metric(1e-160, selected - 1, metric_name="actual_gfa_m2"),
        site_area_m2=1.0,
        maximum_permitted_floor_count=maximum,
    )


def test_tiny_positive_floor_plate_remains_selectable() -> None:
    selected = _select(
        2,
        DesignPreferences(),
        1e-323,
        footprint_area=5e-324,
        site_area=1e-160,
    )

    assert selected == 2


def test_unrepresentable_selected_gfa_preserves_numerical_range_error() -> None:
    with pytest.raises(NumericalRangeError, match="actual_gfa_m2"):
        _select(
            3,
            DesignPreferences(),
            1.7e308,
            footprint_area=1e308,
            site_area=1e308,
        )


@pytest.mark.parametrize(
    ("maximum", "preferences", "targets", "footprint_area", "site_area", "error"),
    [
        (6, object(), DesignTargets(1_500), 400.0, 1_000.0, InvalidDesignPreferences),
        (6, DesignPreferences(), object(), 400.0, 1_000.0, TypeError),
        (-1, DesignPreferences(), DesignTargets(1_500), 400.0, 1_000.0, InvalidDesignPreferences),
        (6, DesignPreferences(), DesignTargets(1_500), 0.0, 1_000.0, ValueError),
        (6, DesignPreferences(), DesignTargets(1_500), math.nan, 1_000.0, ValueError),
        (6, DesignPreferences(), DesignTargets(1_500), 400.0, 0.0, ValueError),
        (6, DesignPreferences(), DesignTargets(1_500), 400.0, math.inf, ValueError),
    ],
)
def test_invalid_selector_inputs_are_rejected(
    maximum: int,
    preferences: object,
    targets: object,
    footprint_area: object,
    site_area: object,
    error: type[Exception],
) -> None:
    with pytest.raises(error):
        select_floor_count_for_target(
            maximum,
            preferences,  # type: ignore[arg-type]
            targets,  # type: ignore[arg-type]
            footprint_area_m2=footprint_area,  # type: ignore[arg-type]
            site_area_m2=site_area,  # type: ignore[arg-type]
        )
