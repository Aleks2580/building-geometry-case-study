"""Pure planar geometry operations, independent of HTTP and persistence."""

from app.geometry.footprints import (
    FootprintLimits,
    InvalidFootprintLimits,
    calculate_footprint_area_upper_bound,
)
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
    "FootprintLimits",
    "InvalidFootprintLimits",
    "InvalidSetback",
    "InvalidSiteGeometry",
    "MultiPolygonGeoJSON",
    "PolygonGeoJSON",
    "SetbackResult",
    "calculate_setback",
    "calculate_footprint_area_upper_bound",
    "normalize_polygon",
    "parse_site_geometry",
    "select_largest_component",
    "serialize_buildable_geometry",
    "serialize_site_geometry",
    "site_area_m2",
]
