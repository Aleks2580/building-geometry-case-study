"""Validated design preferences and pure floor preference selection."""

from dataclasses import dataclass
from math import isfinite


class InvalidDesignPreferences(ValueError):
    """Design preferences do not satisfy the domain contract."""


class PreferenceExceedsHardLimit(ValueError):
    """A preferred floor count is greater than the permitted hard capacity."""


@dataclass(frozen=True, slots=True)
class DesignPreferences:
    """Immutable optional preferences for floor count and footprint area."""

    preferred_floor_count: int | None = None
    preferred_footprint_area_m2: float | None = None

    def __post_init__(self) -> None:
        floor_count = _positive_integer(self.preferred_floor_count, "preferred_floor_count")
        footprint_area = _positive_finite_float(
            self.preferred_footprint_area_m2,
            "preferred_footprint_area_m2",
        )

        object.__setattr__(self, "preferred_floor_count", floor_count)
        object.__setattr__(self, "preferred_footprint_area_m2", footprint_area)


def select_floor_count(
    maximum_permitted_floor_count: int,
    preferences: DesignPreferences,
) -> int | None:
    """Select a preferred floor count within a validated hard capacity.

    Zero capacity is returned as ``None`` before a positive preference can be
    compared with it because capacity infeasibility is resolved by orchestration.
    """

    maximum = _non_negative_integer(maximum_permitted_floor_count, "maximum_permitted_floor_count")
    if not isinstance(preferences, DesignPreferences):
        raise InvalidDesignPreferences("preferences must be a DesignPreferences instance.")

    if maximum == 0:
        return None
    preferred = preferences.preferred_floor_count
    if preferred is None:
        return maximum
    if preferred > maximum:
        raise PreferenceExceedsHardLimit("preferred_floor_count exceeds maximum_permitted_floor_count.")
    return preferred


def _positive_integer(value: object, field_name: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise InvalidDesignPreferences(f"{field_name} must be a strictly positive integer.")
    return value


def _non_negative_integer(value: object, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise InvalidDesignPreferences(f"{field_name} must be a non-negative integer.")
    return value


def _positive_finite_float(value: object, field_name: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidDesignPreferences(f"{field_name} must be a finite positive number.")
    try:
        converted = float(value)
    except OverflowError as error:
        raise InvalidDesignPreferences(f"{field_name} must be representable as a finite float.") from error
    if not isfinite(converted) or converted <= 0:
        raise InvalidDesignPreferences(f"{field_name} must be a finite positive number.")
    return converted
