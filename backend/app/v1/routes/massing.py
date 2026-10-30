from typing import Annotated

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from app.v1.massing import compute_preview
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
    return compute_preview(request)
