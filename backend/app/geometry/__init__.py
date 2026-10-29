"""Pure planar geometry operations, independent of HTTP and persistence."""

from app.geometry.setbacks import (
    Diagnostic,
    InvalidSetback,
    MultiPolygonGeoJSON,
    SetbackResult,
    calculate_setback,
    select_largest_component,
    serialize_buildable_geometry,
)
from app.geometry.site import (
    InvalidSiteGeometry,
    PolygonGeoJSON,
    normalize_polygon,
    parse_site_geometry,
    serialize_site_geometry,
    site_area_m2,
)

__all__ = [
    "Diagnostic",
    "InvalidSetback",
    "InvalidSiteGeometry",
    "MultiPolygonGeoJSON",
    "PolygonGeoJSON",
    "SetbackResult",
    "calculate_setback",
    "normalize_polygon",
    "parse_site_geometry",
    "select_largest_component",
    "serialize_buildable_geometry",
    "serialize_site_geometry",
    "site_area_m2",
]
