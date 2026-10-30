import math

import pytest

from app.massing import FloorLimits, InvalidFloorLimits, calculate_maximum_permitted_floor_count


@pytest.mark.parametrize(
    ("limits", "expected"),
    [
        (FloorLimits(floor_to_floor_m=3.5, max_height_m=24), 6),
        (FloorLimits(floor_to_floor_m=3.5, max_floors=6), 6),
        (FloorLimits(floor_to_floor_m=3.5, max_height_m=24, max_floors=4), 4),
        (FloorLimits(floor_to_floor_m=3.5, max_height_m=24, max_floors=10), 6),
        (FloorLimits(floor_to_floor_m=3.5, max_height_m=21, max_floors=6), 6),
    ],
)
def test_ordinary_limits_calculate_independent_upper_bounds(limits: FloorLimits, expected: int) -> None:
    assert calculate_maximum_permitted_floor_count(limits) == expected


def test_positive_height_below_one_floor_permits_zero() -> None:
    assert calculate_maximum_permitted_floor_count(FloorLimits(3.5, max_height_m=3.49)) == 0
    assert calculate_maximum_permitted_floor_count(FloorLimits(3.5, max_height_m=3.49, max_floors=4)) == 0


@pytest.mark.parametrize(
    ("height", "expected"),
    [
        (3.5, 1),
        (10.0, 4),
        (math.nextafter(10.0, 0.0), 3),
        (math.nextafter(10.0, math.inf), 4),
    ],
)
def test_height_boundaries(height: float, expected: int) -> None:
    assert calculate_maximum_permitted_floor_count(FloorLimits(2.5, max_height_m=height)) == expected


def test_binary64_quotient_rounding_cannot_admit_an_over_height_floor() -> None:
    # Python's float division rounds 1.7 / 0.1 to 17.0, but those exact
    # binary64 inputs make 17 * 0.1 slightly greater than 1.7.
    limits = FloorLimits(floor_to_floor_m=0.1, max_height_m=1.7)

    assert 1.7 / 0.1 == 17.0
    assert 17 * 0.1 > 1.7
    assert calculate_maximum_permitted_floor_count(limits) == 16


def test_decimal_looking_inputs_use_their_binary64_values() -> None:
    # The supplied floats are not decimal rationals; three binary64 floors
    # exceed the binary64 height value in this case.
    assert calculate_maximum_permitted_floor_count(FloorLimits(0.1, max_height_m=0.3)) == 2


def test_large_floor_count_is_kept_as_an_integer() -> None:
    maximum = 10**400
    limits = FloorLimits(floor_to_floor_m=3.5, max_floors=maximum)

    assert limits.max_floors == maximum
    assert isinstance(limits.max_floors, int)
    assert calculate_maximum_permitted_floor_count(limits) == maximum


def test_large_finite_height_ratio_does_not_overflow_to_an_invented_cap() -> None:
    result = calculate_maximum_permitted_floor_count(FloorLimits(5e-324, max_height_m=1.0))

    assert result > 10**323
    assert result.bit_length() > 1000


@pytest.mark.parametrize(
    "value",
    [None, 0, -1, True, False, "3.5", math.nan, math.inf, -math.inf, 10**400],
)
def test_invalid_floor_to_floor_values_are_rejected(value: object) -> None:
    with pytest.raises(InvalidFloorLimits):
        FloorLimits(value, max_floors=1)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "value",
    [0, -1, True, False, "3.5", math.nan, math.inf, -math.inf, 10**400],
)
def test_invalid_supplied_heights_are_rejected_even_with_floor_count(value: object) -> None:
    with pytest.raises(InvalidFloorLimits):
        FloorLimits(3.5, max_height_m=value, max_floors=4)  # type: ignore[arg-type]


@pytest.mark.parametrize("value", [True, False, 6.0, 6.5, "6", 0, -1])
def test_invalid_floor_counts_are_rejected(value: object) -> None:
    with pytest.raises(InvalidFloorLimits):
        FloorLimits(3.5, max_floors=value)  # type: ignore[arg-type]


def test_both_optional_limits_are_required() -> None:
    with pytest.raises(InvalidFloorLimits):
        FloorLimits(3.5)


def test_integer_lengths_are_normalized_to_floats() -> None:
    limits = FloorLimits(3, max_height_m=24)

    assert limits.floor_to_floor_m == 3.0
    assert isinstance(limits.floor_to_floor_m, float)
    assert limits.max_height_m == 24.0
    assert isinstance(limits.max_height_m, float)


def test_floor_limits_are_immutable() -> None:
    limits = FloorLimits(3.5, max_height_m=24)

    with pytest.raises(AttributeError):
        limits.max_height_m = 25.0  # type: ignore[misc]
