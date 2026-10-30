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


@pytest.mark.parametrize("floor_to_floor_m", [3.5, 3.6])
def test_one_floor_capacity_boundary(floor_to_floor_m: float) -> None:
    assert calculate_maximum_permitted_floor_count(FloorLimits(floor_to_floor_m, max_height_m=floor_to_floor_m)) == 1
    assert (
        calculate_maximum_permitted_floor_count(
            FloorLimits(
                floor_to_floor_m,
                max_height_m=math.nextafter(floor_to_floor_m, 0.0),
                max_floors=7,
            )
        )
        == 0
    )
    assert (
        calculate_maximum_permitted_floor_count(
            FloorLimits(floor_to_floor_m, max_height_m=math.nextafter(floor_to_floor_m, math.inf))
        )
        == 1
    )


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


def _exact_height_fits(floor_count: int, floor_to_floor_m: float, max_height_m: float) -> bool:
    floor_numerator, floor_denominator = floor_to_floor_m.as_integer_ratio()
    height_numerator, height_denominator = max_height_m.as_integer_ratio()
    return floor_count * floor_numerator * height_denominator <= height_numerator * floor_denominator


def test_stored_float_boundary_36_m_over_3_6_m_returns_nine() -> None:
    limits = FloorLimits(floor_to_floor_m=3.6, max_height_m=36.0)

    assert 10 * 3.6 == 36.0
    assert not _exact_height_fits(10, 3.6, 36.0)
    assert _exact_height_fits(9, 3.6, 36.0)
    assert calculate_maximum_permitted_floor_count(limits) == 9
    assert calculate_maximum_permitted_floor_count(FloorLimits(3.6, max_height_m=36.0, max_floors=10)) == 9
    assert calculate_maximum_permitted_floor_count(FloorLimits(3.6, max_height_m=36.0, max_floors=8)) == 8
    assert calculate_maximum_permitted_floor_count(FloorLimits(3.6, max_height_m=math.nextafter(36.0, math.inf))) == 10


@pytest.mark.parametrize(
    ("limits", "expected"),
    [
        (FloorLimits(3.5, max_height_m=24), 6),
        (FloorLimits(3.5, max_floors=6), 6),
        (FloorLimits(3.5, max_height_m=24, max_floors=4), 4),
        (FloorLimits(3.5, max_height_m=3.49, max_floors=7), 0),
        (FloorLimits(3.6, max_height_m=36.0, max_floors=10), 9),
    ],
)
def test_returned_capacity_is_admissible_and_maximal(limits: FloorLimits, expected: int) -> None:
    floor_count = calculate_maximum_permitted_floor_count(limits)

    assert floor_count == expected
    assert isinstance(floor_count, int)
    assert floor_count >= 0
    if limits.max_floors is not None:
        assert floor_count <= limits.max_floors
    if limits.max_height_m is not None:
        assert _exact_height_fits(floor_count, limits.floor_to_floor_m, limits.max_height_m)

    next_floor_violates_height = limits.max_height_m is not None and not _exact_height_fits(
        floor_count + 1, limits.floor_to_floor_m, limits.max_height_m
    )
    next_floor_violates_count = limits.max_floors is not None and floor_count + 1 > limits.max_floors
    assert next_floor_violates_height or next_floor_violates_count


def test_large_floor_count_is_kept_as_an_integer() -> None:
    maximum = 10**400
    limits = FloorLimits(floor_to_floor_m=3.5, max_floors=maximum)

    assert limits.max_floors == maximum
    assert isinstance(limits.max_floors, int)
    assert calculate_maximum_permitted_floor_count(limits) == maximum


def test_smallest_positive_float_ratio_is_exact_and_count_bound_still_applies() -> None:
    smallest_positive = math.nextafter(0.0, 1.0)
    result = calculate_maximum_permitted_floor_count(FloorLimits(smallest_positive, max_height_m=1.0))

    assert result == 2**1074
    assert calculate_maximum_permitted_floor_count(FloorLimits(smallest_positive, max_height_m=1.0, max_floors=7)) == 7


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
        FloorLimits(3.5, max_height_m=24, max_floors=value)  # type: ignore[arg-type]


def test_at_least_one_height_or_floor_limit_is_required() -> None:
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
