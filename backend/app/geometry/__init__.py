"""Pure planar geometry operations, independent of HTTP and persistence."""

from app.geometry.site import (
    InvalidSiteGeometry,
    PolygonGeoJSON,
    parse_site_geometry,
    serialize_site_geometry,
    site_area_m2,
)

__all__ = [
    "InvalidSiteGeometry",
    "PolygonGeoJSON",
    "parse_site_geometry",
    "serialize_site_geometry",
    "site_area_m2",
]
