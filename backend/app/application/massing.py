"""Preview orchestration and explicit JSON-compatible result mapping."""

from shapely.geometry import Polygon

from app.geometry import (
    FootprintLimits,
    PolygonGeoJSON,
    parse_site_geometry,
    serialize_buildable_geometry,
    serialize_site_geometry,
)
from app.massing import (
    DesignPreferences,
    DesignTargets,
    FloorLimits,
    PreferenceMassingResult,
    generate_massing_with_preferences,
)


def preview_massing(
    site: object,
    *,
    setback_m: float,
    footprint_limits: FootprintLimits,
    floor_limits: FloorLimits,
    preferences: DesignPreferences,
    targets: DesignTargets,
) -> dict[str, object]:
    result = generate_massing_with_preferences(
        parse_site_geometry(site),
        setback_m=setback_m,
        footprint_limits=footprint_limits,
        floor_limits=floor_limits,
        preferences=preferences,
        targets=targets,
    )
    return map_massing_result(
        result,
        setback_m=setback_m,
        footprint_limits=footprint_limits,
        floor_limits=floor_limits,
    )


def map_massing_result(
    result: PreferenceMassingResult,
    *,
    setback_m: float,
    footprint_limits: FootprintLimits,
    floor_limits: FloorLimits,
) -> dict[str, object]:
    """Keep context, demonstrated capacity, and selected building metrics distinct."""
    default = result.default_result
    setback = default.setback_result
    site = serialize_site_geometry(default.site_geometry)
    area = result.area_preference_result
    target = result.target_assessment

    return {
        "site": site,
        "hard_constraints": {
            "setback_m": setback_m,
            "floor_to_floor_m": floor_limits.floor_to_floor_m,
            "max_height_m": floor_limits.max_height_m,
            "max_floors": floor_limits.max_floors,
            "site_coverage_ratio": footprint_limits.site_coverage_ratio,
            "max_footprint_m2": footprint_limits.max_footprint_area_m2,
        },
        "preferences": {
            "preferred_floor_count": result.preferences.preferred_floor_count,
            "preferred_footprint_area_m2": result.preferences.preferred_footprint_area_m2,
        },
        "targets": {"gfa_target_m2": result.targets.gfa_target_m2},
        "site_geometry": site,
        "buildable_geometry": serialize_buildable_geometry(setback.buildable_geometry),
        "selected_buildable_geometry": _polygon_or_none(setback.selected_buildable_geometry),
        "generated_footprint_geometry": _polygon_or_none(default.generated_footprint_geometry),
        "footprint_geometry": _polygon_or_none(result.footprint_geometry),
        "floor_plate_geometry": _polygon_or_none(result.floor_plate_geometry),
        "metrics": {
            "site_area_m2": setback.site_area_m2,
            "buildable_area_m2": setback.buildable_area_m2,
            "selected_buildable_area_m2": setback.selected_buildable_area_m2,
            "footprint_area_upper_bound_m2": default.footprint_area_upper_bound_m2,
            "gfa_upper_bound_m2": default.gfa_upper_bound_m2,
            "generated_footprint_area_m2": default.generated_footprint_area_m2,
            "generated_gfa_capacity_m2": default.generated_gfa_capacity_m2,
            "maximum_permitted_floor_count": default.maximum_permitted_floor_count,
            "footprint_area_m2": result.footprint_area_m2,
            "floor_count": result.floor_count,
            "floor_to_floor_m": default.floor_to_floor_m,
            "height_m": result.height_m,
            "gfa_m2": result.gfa_m2,
            "site_coverage_ratio": result.site_coverage_ratio,
        },
        "setback": {
            "component_count": setback.component_count,
            "retained_area_m2": setback.retained_area_m2,
            "discarded_area_m2": setback.discarded_area_m2,
        },
        "preference_results": {
            "preferred_floor_count": result.preferences.preferred_floor_count,
            "footprint_area": {
                "original_hard_area_upper_bound_m2": area.original_hard_area_upper_bound_m2,
                "requested_area_m2": area.requested_area_m2,
                "effective_target_m2": area.effective_target_m2,
                "actual_area_m2": area.actual_area_m2,
                "difference_m2": area.difference_m2,
                "effective_target_undershoot_m2": area.effective_target_undershoot_m2,
                "status": area.status,
                "diagnostic_codes": list(area.diagnostic_codes),
            }
            if area is not None
            else None,
        },
        "feasibility": {
            "status": result.status,
            "reason": result.reason,
            "hard_constraints_satisfied": result.hard_constraints_satisfied,
            "target_assessment": {
                "requested_m2": target.gfa_target_m2,
                "actual_m2": result.gfa_m2,
                "shortfall_m2": target.shortfall_m2,
                "status": target.status,
                "diagnostic_code": target.diagnostic_code,
            },
            "diagnostics": _diagnostics(result),
        },
    }


def _polygon_or_none(polygon: Polygon | None) -> PolygonGeoJSON | None:
    return serialize_site_geometry(polygon) if polygon is not None else None


_DIAGNOSTIC_MESSAGES = {
    "ZERO_PERMITTED_FLOORS": "The height limit does not permit a complete floor.",
    "FOOTPRINT_NOT_GENERATED": "No positive default footprint was constructed within the hard limits.",
    "PREFERRED_FOOTPRINT_NOT_GENERATED": "No positive footprint was constructed for the preferred area.",
    "PREFERENCE_CLAMPED_TO_HARD_CAP": "The preferred area is capped at the hard limit for construction.",
    "FOOTPRINT_AREA_APPROXIMATED": "The requested footprint area could not be reproduced within tolerance.",
    "TARGET_EXCEEDS_UPPER_BOUND": "The GFA target exceeds the hard GFA upper bound.",
    "TARGET_BEYOND_GENERATED_CAPACITY": "The GFA target exceeds generated capacity within the hard upper bound.",
    "TARGET_UNMET_WITH_PREFERENCES": "The selected configuration misses a target within generated default capacity.",
}


def _diagnostics(result: PreferenceMassingResult) -> list[dict[str, object]]:
    diagnostics: list[dict[str, object]] = [
        {"code": diagnostic.code, "severity": diagnostic.severity, "message": diagnostic.message}
        for diagnostic in result.default_result.setback_result.diagnostics
    ]
    area = result.area_preference_result
    if area is not None:
        diagnostics.extend(
            {
                "code": code,
                "severity": "warning",
                "message": _DIAGNOSTIC_MESSAGES[code],
                "path": "preferences.preferred_footprint_area_m2",
                "details": {
                    "requested_area_m2": area.requested_area_m2,
                    "effective_target_m2": area.effective_target_m2,
                    "actual_area_m2": area.actual_area_m2,
                    "difference_m2": area.difference_m2,
                },
            }
            for code in area.diagnostic_codes
        )
    # Empty setbacks and failed preferred construction already carry their reason
    # in richer diagnostics. Preserve one entry per code for clients showing alerts.
    if result.reason is not None and not any(item["code"] == result.reason for item in diagnostics):
        diagnostics.append(
            {
                "code": result.reason,
                "severity": "info" if result.status == "infeasible" else "warning",
                "message": _DIAGNOSTIC_MESSAGES[result.reason],
            }
        )
    target = result.target_assessment
    if target.diagnostic_code is not None:
        diagnostics.append(
            {
                "code": target.diagnostic_code,
                "severity": "warning",
                "message": _DIAGNOSTIC_MESSAGES[target.diagnostic_code],
                "path": "targets.gfa_target_m2",
                "details": {
                    "requested_m2": target.gfa_target_m2,
                    "actual_m2": result.gfa_m2,
                    "shortfall_m2": target.shortfall_m2,
                },
            }
        )
    return diagnostics
