"""Floor and height limits for the massing domain."""

from dataclasses import dataclass
from fractions import Fraction
from math import isfinite


class InvalidFloorLimits(ValueError):
    """Floor or height limits do not satisfy the domain contract."""


@dataclass(frozen=True, slots=True)
class FloorLimits:
    """Immutable limits used to calculate a permitted floor-count upper bound."""

    floor_to_floor_m: float
    max_height_m: float | None = None
    max_floors: int | None = None

    def __post_init__(self) -> None:
        floor_to_floor = _positive_finite_float(self.floor_to_floor_m, "floor_to_floor_m")
        max_height = _positive_finite_float(self.max_height_m, "max_height_m", allow_none=True)
        max_floors = _positive_integer(self.max_floors, "max_floors")

        if max_height is None and max_floors is None:
            raise InvalidFloorLimits("At least one of max_height_m or max_floors must be supplied.")

        object.__setattr__(self, "floor_to_floor_m", floor_to_floor)
        object.__setattr__(self, "max_height_m", max_height)
        object.__setattr__(self, "max_floors", max_floors)


def calculate_maximum_permitted_floor_count(limits: FloorLimits) -> int:
    """Return the hard upper bound on floors permitted by ``limits``.

    ``Fraction.from_float`` compares the exact binary64 values supplied by the
    caller. This avoids a rounded quotient admitting an over-height floor and
    also keeps very large finite ratios from overflowing an intermediate float.
    """

    if limits.max_height_m is None:
        # Validation guarantees that a count exists when no height is supplied.
        assert limits.max_floors is not None
        return limits.max_floors

    height = Fraction.from_float(limits.max_height_m)
    floor_to_floor = Fraction.from_float(limits.floor_to_floor_m)
    height_count = height.numerator * floor_to_floor.denominator // (height.denominator * floor_to_floor.numerator)
    if limits.max_floors is None:
        return height_count
    return min(limits.max_floors, height_count)


def _positive_finite_float(value: object, field_name: str, *, allow_none: bool = False) -> float | None:
    if value is None:
        if allow_none:
            return None
        raise InvalidFloorLimits(f"{field_name} must be a finite positive number.")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidFloorLimits(f"{field_name} must be a finite positive number.")
    try:
        converted = float(value)
    except OverflowError as error:
        raise InvalidFloorLimits(f"{field_name} must be representable as a finite float.") from error
    if not isfinite(converted) or converted <= 0:
        raise InvalidFloorLimits(f"{field_name} must be a finite positive number.")
    return converted


def _positive_integer(value: object, field_name: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise InvalidFloorLimits(f"{field_name} must be a strictly positive integer.")
    return value
