from typing import Annotated

from fastapi import APIRouter, Body
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
from app.v1.schemas.massing import ErrorResponse, MassingPreviewRequest, MassingPreviewResponse

router = APIRouter(prefix="/massing", tags=["massing"])


@router.post(
    "/preview",
    response_model=MassingPreviewResponse,
    summary="Preview one building massing",
    description=(
        "Compute a transient massing from a planar Polygon in metres. Polygon holes and split "
        "MultiPolygon setbacks are preserved. All four feasibility statuses return 200; unavailable "
        "building geometry and metrics are null. Preferences remain subordinate to hard limits, "
        "and a GFA target is a desired minimum. No data is saved."
    ),
    responses={422: {"model": ErrorResponse, "description": "Invalid input, preference, or numerical range."}},
)
def preview(
    request: Annotated[
        MassingPreviewRequest,
        Body(
            openapi_examples={
                "target_driven": {
                    "summary": "Rectangle with a minimum GFA target",
                    "description": "Produces a 646 m² footprint, four floors, and 2584 m² GFA.",
                    "value": {
                        "site": {
                            "type": "Polygon",
                            "coordinates": [[[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]]],
                        },
                        "hard_constraints": {
                            "setback_m": 3,
                            "floor_to_floor_m": 3.5,
                            "max_height_m": 24,
                            "max_floors": 6,
                        },
                        "preferences": {},
                        "targets": {"gfa_target_m2": 2000},
                    },
                }
            }
        ),
    ],
) -> MassingPreviewResponse | JSONResponse:
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
