import math

import pytest

from app.massing import (
    DesignPreferences,
    FloorLimits,
    InvalidDesignPreferences,
    PreferenceExceedsHardLimit,
    calculate_maximum_permitted_floor_count,
    select_floor_count,
)


def test_preferences_allow_both_fields_to_be_absent() -> None:
    preferences = DesignPreferences()

    assert preferences.preferred_floor_count is None
    assert preferences.preferred_footprint_area_m2 is None


@pytest.mark.parametrize(
    ("preferences", "expected_floor_count", "expected_footprint_area_m2"),
    [
        (DesignPreferences(preferred_floor_count=4), 4, None),
        (DesignPreferences(preferred_footprint_area_m2=420.5), None, 420.5),
        (DesignPreferences(preferred_floor_count=4, preferred_footprint_area_m2=420.5), 4, 420.5),
    ],
)
def test_preferences_accept_each_field_independently(
    preferences: DesignPreferences,
    expected_floor_count: int | None,
    expected_footprint_area_m2: float | None,
) -> None:
    assert preferences.preferred_floor_count == expected_floor_count
    assert preferences.preferred_footprint_area_m2 == expected_footprint_area_m2


def test_integer_footprint_area_is_normalized_to_float() -> None:
    preferences = DesignPreferences(preferred_footprint_area_m2=420)

    assert preferences.preferred_footprint_area_m2 == 420.0
    assert isinstance(preferences.preferred_footprint_area_m2, float)


def test_preferences_are_immutable() -> None:
    preferences = DesignPreferences(preferred_floor_count=4)

    with pytest.raises(AttributeError):
        preferences.preferred_floor_count = 5  # type: ignore[misc]


@pytest.mark.parametrize(
    "value",
    [0, -1, True, False, 4.0, 4.5, "4"],
)
def test_invalid_floor_preferences_are_rejected(value: object) -> None:
    with pytest.raises(InvalidDesignPreferences):
        DesignPreferences(preferred_floor_count=value, preferred_footprint_area_m2=420.5)  # type: ignore[arg-type]


def test_very_large_floor_preference_remains_an_integer() -> None:
    value = 10**400
    preferences = DesignPreferences(preferred_floor_count=value)

    assert preferences.preferred_floor_count == value
    assert isinstance(preferences.preferred_floor_count, int)


@pytest.mark.parametrize(
    "value",
    [0, -1, True, False, "420", math.nan, math.inf, -math.inf, 10**400],
)
def test_invalid_footprint_area_preferences_are_rejected(value: object) -> None:
    with pytest.raises(InvalidDesignPreferences):
        DesignPreferences(preferred_floor_count=4, preferred_footprint_area_m2=value)  # type: ignore[arg-type]


def test_small_positive_footprint_area_is_valid() -> None:
    value = math.nextafter(0.0, 1.0)

    preferences = DesignPreferences(preferred_footprint_area_m2=value)

    assert preferences.preferred_footprint_area_m2 == value


@pytest.mark.parametrize(
    ("preferences", "expected"),
    [
        (DesignPreferences(), 6),
        (DesignPreferences(preferred_floor_count=4), 4),
        (DesignPreferences(preferred_floor_count=6), 6),
        (DesignPreferences(preferred_footprint_area_m2=100), 6),
    ],
)
def test_floor_selection_respects_floor_preference_only(
    preferences: DesignPreferences,
    expected: int,
) -> None:
    assert select_floor_count(6, preferences) == expected


def test_floor_preference_above_capacity_is_rejected() -> None:
    with pytest.raises(PreferenceExceedsHardLimit):
        select_floor_count(6, DesignPreferences(preferred_floor_count=7))


def test_zero_capacity_returns_none_with_or_without_floor_preference() -> None:
    assert select_floor_count(0, DesignPreferences()) is None
    assert select_floor_count(0, DesignPreferences(preferred_floor_count=1)) is None


@pytest.mark.parametrize("maximum_permitted_floor_count", [6, 0])
@pytest.mark.parametrize("preferences", [None, object(), "preferences"])
def test_invalid_design_preferences_arguments_are_rejected_at_any_capacity(
    maximum_permitted_floor_count: int,
    preferences: object,
) -> None:
    with pytest.raises(InvalidDesignPreferences):
        select_floor_count(maximum_permitted_floor_count, preferences)  # type: ignore[arg-type]


def test_floor_preference_matches_stored_float_height_boundary() -> None:
    maximum = calculate_maximum_permitted_floor_count(FloorLimits(floor_to_floor_m=3.6, max_height_m=36.0))

    assert maximum == 9
    assert select_floor_count(maximum, DesignPreferences(preferred_floor_count=9)) == 9
    with pytest.raises(PreferenceExceedsHardLimit):
        select_floor_count(maximum, DesignPreferences(preferred_floor_count=10))
    assert select_floor_count(maximum, DesignPreferences(preferred_floor_count=4)) == 4


@pytest.mark.parametrize("value", [None, -1, True, False, 6.0, 6.5, "6"])
def test_invalid_direct_capacities_are_rejected(value: object) -> None:
    with pytest.raises(InvalidDesignPreferences):
        select_floor_count(value, DesignPreferences())  # type: ignore[arg-type]
