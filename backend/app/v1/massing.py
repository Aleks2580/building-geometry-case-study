from fastapi.responses import JSONResponse

from app.application.massing import preview_massing
from app.geometry import FootprintLimits, InvalidFootprintLimits, InvalidSetback, InvalidSiteGeometry
from app.massing import (
    DesignPreferences,
    DesignTargets,
    FloorLimits,
    InvalidDesignPreferences,
    InvalidDesignTargets,
    InvalidFloorLimits,
    NumericalRangeError,
    PreferenceExceedsHardLimit,
)
from app.v1.errors import validation_response
from app.v1.schemas.massing import MassingPreviewRequest, MassingPreviewResponse


def compute_preview(request: MassingPreviewRequest) -> MassingPreviewResponse | JSONResponse:
    constraints = request.hard_constraints
    try:
        result = preview_massing(
            request.site.model_dump(),
            setback_m=constraints.setback_m,
            footprint_limits=FootprintLimits(
                site_coverage_ratio=constraints.site_coverage_ratio,
                max_footprint_area_m2=constraints.max_footprint_m2,
            ),
            floor_limits=FloorLimits(
                floor_to_floor_m=constraints.floor_to_floor_m,
                max_height_m=constraints.max_height_m,
                max_floors=constraints.max_floors,
            ),
            preferences=DesignPreferences(
                preferred_floor_count=request.preferences.preferred_floor_count,
                preferred_footprint_area_m2=request.preferences.preferred_footprint_area_m2,
            ),
            targets=DesignTargets(gfa_target_m2=request.targets.gfa_target_m2),
        )
    except InvalidSiteGeometry as error:
        path = "site" if error.path == "site" else f"site.{error.path}"
        return validation_response("INVALID_SITE_GEOMETRY", str(error), path=path)
    except (InvalidSetback, InvalidFootprintLimits, InvalidFloorLimits) as error:
        return validation_response("INVALID_CONSTRAINTS", str(error), path="hard_constraints")
    except InvalidDesignPreferences as error:
        return validation_response("INVALID_PREFERENCE", str(error), path="preferences")
    except InvalidDesignTargets as error:
        return validation_response("INVALID_TARGET", str(error), path="targets.gfa_target_m2")
    except PreferenceExceedsHardLimit as error:
        return validation_response(
            "PREFERENCE_EXCEEDS_HARD_LIMIT", str(error), path="preferences.preferred_floor_count"
        )
    except NumericalRangeError as error:
        return validation_response("NUMERICAL_RANGE_ERROR", str(error), path="hard_constraints")
    return MassingPreviewResponse.model_validate(result)
