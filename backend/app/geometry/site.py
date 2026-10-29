"""Validation and canonical serialization of planar site polygons in metres."""

from collections.abc import Mapping, Sequence
from itertools import groupby
from math import isfinite
from typing import Literal, TypedDict, cast

from shapely import normalize, orient_polygons
from shapely.geometry import Polygon
from shapely.validation import explain_validity

type Position = tuple[float, float]


class PolygonGeoJSON(TypedDict):
    type: Literal["Polygon"]
    coordinates: list[list[list[float]]]


class InvalidSiteGeometry(ValueError):
    """Invalid site input with a domain path for later transport translation."""

    def __init__(self, message: str, *, path: str = "coordinates") -> None:
        super().__init__(message)
        self.path = path


def parse_site_geometry(value: object) -> Polygon:
    """Parse a closed-ring 2D Polygon in metres, rejecting rather than repairing it."""
    if not isinstance(value, Mapping):
        raise InvalidSiteGeometry("Site geometry must be a Polygon object.", path="site")
    geometry = cast(Mapping[str, object], value)
    if geometry.get("type") != "Polygon":
        raise InvalidSiteGeometry("Only Polygon site geometry is supported.", path="type")

    coordinates = _array(geometry.get("coordinates"), "coordinates")
    if not coordinates:
        raise InvalidSiteGeometry("A Polygon must have an exterior ring.")
    rings = [_parse_ring(ring, f"coordinates[{index}]") for index, ring in enumerate(coordinates)]
    polygon = Polygon(rings[0], rings[1:])
    _validate_topology_and_area(polygon)
    return _canonicalize(polygon)


def serialize_site_geometry(polygon: Polygon) -> PolygonGeoJSON:
    """Serialize closed rings, dropping exact adjacent duplicates without rounding."""
    _validate_polygon(polygon)
    canonical = _canonicalize(polygon)
    return {
        "type": "Polygon",
        "coordinates": [
            [[0.0 if x == 0 else float(x), 0.0 if y == 0 else float(y)] for x, y in ring.coords]
            for ring in [canonical.exterior, *canonical.interiors]
        ],
    }


def site_area_m2(polygon: Polygon) -> float:
    """Measure a valid site in square metres, subtracting interior holes."""
    _validate_polygon(polygon)
    return float(polygon.area)


def _array(value: object, path: str) -> Sequence[object]:
    if not isinstance(value, (list, tuple)):
        raise InvalidSiteGeometry("Expected a coordinate array.", path=path)
    return cast(Sequence[object], value)


def _ordinate(value: object, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidSiteGeometry("Coordinates must be numeric, excluding booleans.", path=path)
    try:
        number = float(value)
    except OverflowError as error:
        raise InvalidSiteGeometry("Coordinates must be finite double-precision numbers.", path=path) from error
    if not isfinite(number):
        raise InvalidSiteGeometry("Coordinates must be finite.", path=path)
    return 0.0 if number == 0 else number


def _parse_ring(value: object, path: str) -> list[Position]:
    coordinates = _array(value, path)
    ring: list[Position] = []
    for index, coordinate in enumerate(coordinates):
        position_path = f"{path}[{index}]"
        position = _array(coordinate, position_path)
        if len(position) != 2:
            raise InvalidSiteGeometry("Each position must contain exactly two coordinates.", path=position_path)
        ring.append((_ordinate(position[0], f"{position_path}[0]"), _ordinate(position[1], f"{position_path}[1]")))

    if len(ring) < 4:
        raise InvalidSiteGeometry("Rings must be explicitly closed with at least four positions.", path=path)
    # Check the input before binary64 conversion can collapse distinct integers.
    if tuple(_array(coordinates[0], path)) != tuple(_array(coordinates[-1], path)):
        raise InvalidSiteGeometry("Rings must be explicitly closed.", path=path)
    if len(set(ring[:-1])) < 3:
        raise InvalidSiteGeometry("Rings must contain at least three distinct vertices.", path=path)
    ring_area = float(Polygon(ring).area)
    if not isfinite(ring_area) or ring_area <= 0:
        raise InvalidSiteGeometry("Rings must have finite, positive area.", path=path)
    return ring


def _validate_polygon(polygon: Polygon) -> None:
    if not isinstance(polygon, Polygon):
        raise InvalidSiteGeometry("Only Polygon site geometry is supported.", path="type")
    if polygon.is_empty:
        raise InvalidSiteGeometry("A Polygon must have an exterior ring.")
    if polygon.has_z or polygon.has_m:
        raise InvalidSiteGeometry("Site geometry must have exactly two coordinate dimensions.")
    for index, ring in enumerate([polygon.exterior, *polygon.interiors]):
        _parse_ring(list(ring.coords), f"coordinates[{index}]")
    _validate_topology_and_area(polygon)


def _validate_topology_and_area(polygon: Polygon) -> None:
    if not polygon.is_valid:
        raise InvalidSiteGeometry(f"Invalid polygon topology: {explain_validity(polygon)}.")
    if not isfinite(polygon.area) or polygon.area <= 0:
        raise InvalidSiteGeometry("Site area must be finite and strictly positive.")


def _canonicalize(polygon: Polygon) -> Polygon:
    # GEOS zero-tolerance removal can discard distinct coordinates at tiny
    # separations. Group exact tuples to remove only adjacent duplicates.
    rings = [[position for position, _ in groupby(ring.coords)] for ring in [polygon.exterior, *polygon.interiors]]
    deduplicated = Polygon(rings[0], rings[1:])
    # GEOS normal form fixes ring starts and hole order; orient afterwards to use
    # GeoJSON winding. Neither step may repair topology or apply a precision grid.
    return orient_polygons(normalize(deduplicated))
