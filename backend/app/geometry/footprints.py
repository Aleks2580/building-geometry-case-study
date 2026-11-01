"""Hard area limits and deterministic default footprint construction."""

from collections.abc import Iterable
from dataclasses import dataclass
from math import fsum, hypot, isfinite
from typing import Literal

from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, box
from shapely.geometry.base import BaseGeometry

from app.geometry.setbacks import SetbackResult, inward_buffer, select_largest_component
from app.geometry.site import normalize_polygon, serialize_site_geometry
from app.geometry.tolerances import area_tolerance_m2


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


type FootprintConstructionOutcome = Literal["success", "empty_buildable_region", "generation_failed"]


@dataclass(frozen=True, slots=True)
class FootprintResult:
    """Result of constructing one default footprint within the hard area bound."""

    footprint_area_upper_bound_m2: float
    generated_footprint_geometry: Polygon | None
    generated_footprint_area_m2: float | None
    outcome: FootprintConstructionOutcome
    secondary_component_count: int
    secondary_discarded_area_m2: float
    undershoot_m2: float | None


MAX_FOOTPRINT_SEARCH_ITERATIONS = 48
_MAX_CLIP_SEARCH_ITERATIONS = 48
_MAX_BRACKET_EXPANSIONS = 8


def calculate_footprint_area_upper_bound(setback: SetbackResult, limits: FootprintLimits) -> float:
    """Calculate the hard upper bound for a footprint in square metres."""
    bounds = [setback.selected_buildable_area_m2]
    if limits.site_coverage_ratio is not None:
        bounds.append(setback.site_area_m2 * limits.site_coverage_ratio)
    if limits.max_footprint_area_m2 is not None:
        bounds.append(limits.max_footprint_area_m2)
    return float(min(bounds))


def generate_footprint(setback: SetbackResult, limits: FootprintLimits) -> FootprintResult:
    """Construct one deterministic footprint within the calculated hard area bound."""
    upper_bound = calculate_footprint_area_upper_bound(setback, limits)
    if not isfinite(upper_bound) or upper_bound < 0:
        raise RuntimeError("Footprint area upper bound must be finite and non-negative.")
    selected = setback.selected_buildable_geometry
    if selected is None or selected.is_empty:
        return _result_without_geometry(upper_bound, "empty_buildable_region")

    canonical_selected = normalize_polygon(selected)
    selected_area = float(canonical_selected.area)
    if not isfinite(selected_area) or selected_area <= 0:
        raise RuntimeError("Selected buildable geometry must have finite positive area.")
    if selected_area <= upper_bound:
        return _result_from_candidate(
            upper_bound,
            _Candidate(canonical_selected, selected_area, 1, 0.0),
        )

    selected = canonical_selected
    tolerance = area_tolerance_m2(setback.site_area_m2)
    high = _search_bracket(selected, tolerance)
    low = 0.0
    best: _Candidate | None = None
    for _ in range(MAX_FOOTPRINT_SEARCH_ITERATIONS):
        midpoint = low + (high - low) / 2.0
        if not isfinite(midpoint) or midpoint == low or midpoint == high:
            break
        candidate = _buffer_candidate(selected, midpoint, tolerance)
        if candidate is None:
            high = midpoint
            continue
        if candidate.area_m2 <= upper_bound:
            if best is None or candidate.area_m2 > best.area_m2:
                best = candidate
            high = midpoint
        else:
            low = midpoint

    if best is None:
        return _result_without_geometry(upper_bound, "generation_failed")
    # Buffer splits can skip attainable areas. Keep ordinary buffer results and
    # their geometry unless bounded clipping demonstrates a material improvement.
    if upper_bound - best.area_m2 > tolerance:
        clipped = _best_clipped_candidate(selected, upper_bound, tolerance)
        if clipped is not None and clipped.area_m2 - best.area_m2 > tolerance:
            best = clipped
    return _result_from_candidate(upper_bound, best)


@dataclass(frozen=True, slots=True)
class _Candidate:
    geometry: Polygon
    area_m2: float
    component_count: int
    discarded_area_m2: float


def _result_without_geometry(upper_bound: float, outcome: FootprintConstructionOutcome) -> FootprintResult:
    return FootprintResult(
        footprint_area_upper_bound_m2=upper_bound,
        generated_footprint_geometry=None,
        generated_footprint_area_m2=None,
        outcome=outcome,
        secondary_component_count=0,
        secondary_discarded_area_m2=0.0,
        undershoot_m2=None,
    )


def _result_from_candidate(upper_bound: float, candidate: _Candidate) -> FootprintResult:
    if not isfinite(candidate.area_m2) or candidate.area_m2 <= 0:
        raise RuntimeError("Generated footprint must have finite positive area.")
    if not isfinite(candidate.discarded_area_m2) or candidate.discarded_area_m2 < 0:
        raise RuntimeError("Generated footprint discarded area must be finite and non-negative.")
    if candidate.area_m2 > upper_bound:
        raise RuntimeError("Generated footprint exceeds its hard area upper bound.")
    return FootprintResult(
        footprint_area_upper_bound_m2=upper_bound,
        generated_footprint_geometry=candidate.geometry,
        generated_footprint_area_m2=candidate.area_m2,
        outcome="success",
        secondary_component_count=candidate.component_count,
        secondary_discarded_area_m2=candidate.discarded_area_m2,
        undershoot_m2=upper_bound - candidate.area_m2,
    )


def _search_bracket(selected: Polygon, tolerance: float) -> float:
    min_x, min_y, max_x, max_y = selected.bounds
    width = max_x - min_x
    height = max_y - min_y
    extent = hypot(width, height)
    if not isfinite(extent) or extent <= 0:
        raise RuntimeError("Selected buildable geometry must have a finite positive extent.")

    high = extent
    for _ in range(_MAX_BRACKET_EXPANSIONS + 1):
        if _buffer_candidate(selected, high, tolerance) is None:
            return high
        doubled = high * 2.0
        if not isfinite(doubled) or doubled == high:
            break
        high = doubled
    raise RuntimeError("Unable to bracket an empty inward-buffer result.")


def _buffer_candidate(selected: Polygon, distance: float, tolerance: float) -> _Candidate | None:
    buffered = inward_buffer(selected, distance)
    if not isinstance(buffered, (Polygon, MultiPolygon)) or not buffered.is_valid:
        raise RuntimeError("Inward buffer returned invalid non-polygonal geometry.")
    return _candidate_from_geometry(selected, buffered, tolerance)


def _best_clipped_candidate(selected: Polygon, upper_bound: float, tolerance: float) -> _Candidate | None:
    best: _Candidate | None = None
    original_bounds = selected.bounds
    # Fixed direction order resolves exact area ties. Each retained half-plane is
    # nested, so its largest connected area is monotone even when parts split.
    for axis, keep_lower in ((0, True), (0, False), (1, True), (1, False)):
        minimum, maximum = original_bounds[axis], original_bounds[axis + 2]
        low, high = 0.0, maximum - minimum
        for _ in range(_MAX_CLIP_SEARCH_ITERATIONS):
            midpoint = low + (high - low) / 2.0
            if midpoint == low or midpoint == high:
                break
            bounds = list(original_bounds)
            bounds[axis + 2 if keep_lower else axis] = minimum + midpoint if keep_lower else maximum - midpoint
            clip = box(bounds[0], bounds[1], bounds[2], bounds[3])
            candidate = _candidate_from_geometry(selected, selected.intersection(clip), tolerance)
            fits = candidate is None or candidate.area_m2 <= upper_bound
            if candidate is not None and fits and (best is None or candidate.area_m2 > best.area_m2):
                best = candidate
            if fits:
                low = midpoint
            else:
                high = midpoint
    return best


def _candidate_from_geometry(selected: Polygon, geometry: BaseGeometry, tolerance: float) -> _Candidate | None:
    if not geometry.is_valid:
        raise RuntimeError("Footprint construction returned invalid geometry.")
    total_area = float(geometry.area)
    if not isfinite(total_area):
        raise RuntimeError("Footprint construction returned non-finite area.")
    if geometry.is_empty:
        return None
    if not selected.covers(geometry):
        raise RuntimeError("Footprint construction extends outside the selected buildable component.")

    components = tuple(_positive_components(geometry))
    if not components:
        return None
    normalized = tuple(normalize_polygon(component) for component in components)
    selected_component = select_largest_component(normalized)
    if selected_component is None:
        raise RuntimeError("Generated footprint has no positive component.")
    if not selected.covers(selected_component):
        raise RuntimeError("Generated footprint extends outside the selected buildable component.")
    area_m2 = float(selected_component.area)
    if not isfinite(area_m2) or area_m2 <= 0:
        raise RuntimeError("Generated footprint must have finite positive area.")
    component_area = fsum(float(component.area) for component in normalized)
    if abs(component_area - total_area) > tolerance:
        raise RuntimeError("Generated footprint and component areas disagree.")

    selected_key = serialize_site_geometry(selected_component)
    discarded_areas: list[float] = []
    matched = False
    for component in normalized:
        if not matched and serialize_site_geometry(component) == selected_key:
            matched = True
        else:
            discarded_areas.append(float(component.area))
    discarded = fsum(discarded_areas)
    if not matched or not isfinite(discarded):
        raise RuntimeError("Generated footprint component accounting failed.")
    return _Candidate(selected_component, area_m2, len(normalized), discarded)


def _positive_components(geometry: BaseGeometry) -> Iterable[Polygon]:
    if isinstance(geometry, (MultiPolygon, GeometryCollection)):
        # Intersections can retain boundary lines beside polygons. They contribute
        # no floor area and must not count as building components or be repaired.
        for component in geometry.geoms:
            yield from _positive_components(component)
    elif isinstance(geometry, Polygon):
        area = float(geometry.area)
        if not isfinite(area):
            raise RuntimeError("Generated footprint component has non-finite area.")
        if area > 0:
            yield geometry


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
