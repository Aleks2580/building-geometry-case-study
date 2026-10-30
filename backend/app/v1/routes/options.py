from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from app.application.options import save_root_option
from app.persistence.options import OptionRepository
from app.v1.dependencies import get_option_repository
from app.v1.massing import compute_preview
from app.v1.schemas.massing import ErrorResponse
from app.v1.schemas.options import OptionResponse, OptionSummaryResponse, RootOptionRequest

router = APIRouter(prefix="/options", tags=["options"])
type RepositoryDependency = Annotated[OptionRepository, Depends(get_option_repository)]


@router.post(
    "",
    status_code=201,
    response_model=OptionResponse,
    summary="Compute and save a root option",
    description=(
        "Recompute the supplied configuration with the preview engine and insert a complete immutable "
        "snapshot. All four feasibility statuses can be saved, including diagnostic snapshots with "
        "null building geometry. Client-computed results and parent identifiers are rejected."
    ),
    responses={422: {"model": ErrorResponse, "description": "Invalid configuration or optional name."}},
)
async def create_root_option(
    request: RootOptionRequest, response: Response, repository: RepositoryDependency
) -> OptionResponse | JSONResponse:
    preview = await run_in_threadpool(compute_preview, request)
    if isinstance(preview, JSONResponse):
        return preview
    snapshot = await save_root_option(repository, preview.model_dump(mode="json"), name=request.name)
    response.headers["Location"] = f"/api/v1/options/{snapshot.id}"
    return OptionResponse.model_validate(snapshot, from_attributes=True)


@router.get(
    "",
    response_model=list[OptionSummaryResponse],
    summary="List saved option summaries",
    description="Return metadata and metrics, newest first with UUID as a deterministic tie-breaker.",
    responses={422: {"model": ErrorResponse}},
)
async def list_options(
    repository: RepositoryDependency,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[OptionSummaryResponse]:
    summaries = await repository.list_summaries(limit=limit, offset=offset)
    return [OptionSummaryResponse.model_validate(summary, from_attributes=True) for summary in summaries]


@router.get(
    "/{option_id}",
    response_model=OptionResponse,
    summary="Retrieve an immutable option snapshot",
    description="Read the stored configuration and result without recomputing historical geometry or metrics.",
    responses={404: {"model": ErrorResponse, "description": "Option not found."}, 422: {"model": ErrorResponse}},
)
async def get_option(option_id: UUID, repository: RepositoryDependency) -> OptionResponse | JSONResponse:
    snapshot = await repository.get(option_id)
    if snapshot is None:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse.model_validate(
                {
                    "error": {
                        "code": "OPTION_NOT_FOUND",
                        "message": "Option not found.",
                        "details": [{"path": "option_id", "message": "No saved option has this identifier."}],
                    }
                }
            ).model_dump(mode="json"),
        )
    return OptionResponse.model_validate(snapshot, from_attributes=True)
