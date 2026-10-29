"""Pure inward setbacks and deterministic single-component selection."""

from collections.abc import Iterable
from dataclasses import dataclass
from math import fsum, isfinite
from typing import Literal, TypedDict

from shapely.geometry import MultiPolygon, Polygon

from app.geometry.site import PolygonGeoJSON, normalize_polygon, serialize_site_geometry
from app.geometry.tolerances import area_tolerance_m2


class MultiPolygonGeoJSON(TypedDict):
    type: Literal["MultiPolygon"]
    coordinates: list[list[list[list[float]]]]


class InvalidSetback(ValueError):
    """The setback distance is not a finite, non-negative number of metres."""


@dataclass(frozen=True, slots=True)
class Diagnostic:
    code: Literal["EMPTY_BUILDABLE_REGION", "BUILDABLE_REGION_SPLIT"]
    severity: Literal["info", "warning"]
    message: str


@dataclass(frozen=True, slots=True)
class SetbackResult:
    site_area_m2: float
    buildable_geometry: Polygon | MultiPolygon
    selected_buildable_geometry: Polygon | None
    buildable_area_m2: float
    selected_buildable_area_m2: float
    component_count: int
    discarded_area_m2: float
    diagnostics: tuple[Diagnostic, ...]

    @property
    def retained_area_m2(self) -> float:
        return self.selected_buildable_area_m2


def calculate_setback(site: Polygon, setback_m: float) -> SetbackResult:
    """Inset a valid site in metres, retaining all components and selecting one."""
    site = normalize_polygon(site)
    distance = _setback_distance(setback_m)
    # buffer(0) may simplify distinct vertices even on valid input. Zero setback
    # therefore uses the same representation policy as the site foundation.
    buffered = site if distance == 0 else site.buffer(-distance, join_style="mitre", mitre_limit=5)
    components = _ordered_components(_polygon_components(buffered))
    selected = components[0] if components else None
    buildable = MultiPolygon(components) if len(components) > 1 else selected if selected is not None else Polygon()
    site_area = float(site.area)
    buildable_area = float(buildable.area)
    tolerance = area_tolerance_m2(site_area)

    _check_invariants(site, buildable, components, tolerance)
    if not components:
        diagnostics = (
            Diagnostic("EMPTY_BUILDABLE_REGION", "info", "Setback leaves no positive-area buildable region."),
        )
    elif len(components) > 1:
        diagnostics = (
            Diagnostic(
                "BUILDABLE_REGION_SPLIT",
                "warning",
                "Setback produced multiple buildable components; one largest component was selected.",
            ),
        )
    else:
        diagnostics = ()

    return SetbackResult(
        site_area_m2=site_area,
        buildable_geometry=buildable,
        selected_buildable_geometry=selected,
        buildable_area_m2=buildable_area,
        selected_buildable_area_m2=float(selected.area) if selected is not None else 0.0,
        component_count=len(components),
        # Subtracting from the total can erase a very small discarded component.
        discarded_area_m2=fsum(float(component.area) for component in components[1:]),
        diagnostics=diagnostics,
    )


def select_largest_component(components: Iterable[Polygon]) -> Polygon | None:
    """Select by exact descending area, then bounding box and canonical coordinates."""
    ordered = _ordered_components(components)
    return ordered[0] if ordered else None


def serialize_buildable_geometry(geometry: Polygon | MultiPolygon) -> PolygonGeoJSON | MultiPolygonGeoJSON | None:
    """Serialize a complete buildable region deterministically; empty regions are null."""
    components = _ordered_components(_polygon_components(geometry))
    if not components:
        return None
    if len(components) == 1:
        return serialize_site_geometry(components[0])
    return {
        "type": "MultiPolygon",
        "coordinates": [serialize_site_geometry(component)["coordinates"] for component in components],
    }


def _setback_distance(value: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidSetback("Setback must be a finite, non-negative number of metres.")
    try:
        distance = float(value)
    except OverflowError as error:
        raise InvalidSetback("Setback must be finite.") from error
    if not isfinite(distance) or distance < 0:
        raise InvalidSetback("Setback must be finite and non-negative.")
    return distance


def _polygon_components(geometry: Polygon | MultiPolygon) -> tuple[Polygon, ...]:
    if not isinstance(geometry, (Polygon, MultiPolygon)) or not geometry.is_valid:
        raise RuntimeError("Expected valid polygonal buildable geometry.")
    if not isfinite(geometry.area):
        raise RuntimeError("Buildable geometry must have finite area.")
    if geometry.is_empty:
        return ()
    components = (geometry,) if isinstance(geometry, Polygon) else tuple(geometry.geoms)
    return tuple(component for component in components if component.area > 0)


def _ordered_components(components: Iterable[Polygon]) -> list[Polygon]:
    normalized = [normalize_polygon(component) for component in components if not component.is_empty]
    # Tolerance is for invariant comparisons, never for discarding small polygons
    # or allowing a smaller component to win the documented largest-area choice.
    return sorted(
        normalized,
        key=lambda component: (-component.area, component.bounds, serialize_site_geometry(component)["coordinates"]),
    )


def _check_invariants(
    site: Polygon, buildable: Polygon | MultiPolygon, components: list[Polygon], tolerance: float
) -> None:
    total = float(buildable.area)
    if not buildable.is_valid:
        raise RuntimeError("Normalized buildable geometry must remain valid.")
    if not isfinite(total) or abs(fsum(float(component.area) for component in components) - total) > tolerance:
        raise RuntimeError("Buildable geometry and component areas disagree.")
    if total > site.area + tolerance:
        raise RuntimeError("Buildable area exceeds the site area.")
    # Small escaped area can hide distant geometry or a long protrusion.
    # Boundary contact is valid, so use covers for the containment predicate.
    if not buildable.is_empty and not site.covers(buildable):
        raise RuntimeError("Buildable geometry extends outside the site.")
