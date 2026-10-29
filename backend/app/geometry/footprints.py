"""Hard area limits for building footprints."""

from dataclasses import dataclass
from math import isfinite

from app.geometry.setbacks import SetbackResult


class InvalidFootprintLimits(ValueError):
    """A footprint area limit is invalid."""


@dataclass(frozen=True, slots=True)
class FootprintLimits:
    """Optional hard limits on the permitted footprint area."""

    site_coverage_ratio: float | None = None
    max_footprint_area_m2: float | None = None

    def __post_init__(self) -> None:
        coverage = _finite_float(self.site_coverage_ratio, "site_coverage_ratio")
        if coverage is not None and not 0 < coverage <= 1:
            raise InvalidFootprintLimits("site_coverage_ratio must be greater than 0 and no greater than 1.")

        maximum = _finite_float(self.max_footprint_area_m2, "max_footprint_area_m2")
        if maximum is not None and maximum <= 0:
            raise InvalidFootprintLimits("max_footprint_area_m2 must be strictly positive.")

        object.__setattr__(self, "site_coverage_ratio", coverage)
        object.__setattr__(self, "max_footprint_area_m2", maximum)


def calculate_footprint_area_upper_bound(setback: SetbackResult, limits: FootprintLimits) -> float:
    """Calculate the hard upper bound for a footprint in square metres."""
    bounds = [setback.selected_buildable_area_m2]
    if limits.site_coverage_ratio is not None:
        bounds.append(setback.site_area_m2 * limits.site_coverage_ratio)
    if limits.max_footprint_area_m2 is not None:
        bounds.append(limits.max_footprint_area_m2)
    return float(min(bounds))


def _finite_float(value: object, field_name: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidFootprintLimits(f"{field_name} must be a finite number.")
    try:
        converted = float(value)
    except OverflowError as error:
        raise InvalidFootprintLimits(f"{field_name} must be representable as a finite float.") from error
    if not isfinite(converted):
        raise InvalidFootprintLimits(f"{field_name} must be finite.")
    return converted
