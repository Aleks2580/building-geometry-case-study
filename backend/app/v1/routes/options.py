from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from app.application.options import OptionTree, ParentOptionNotFound, branch_option, get_option_tree, save_root_option
from app.persistence.options import OptionRepository
from app.v1.dependencies import get_option_repository
from app.v1.errors import not_found_response
from app.v1.massing import MASSING_VALIDATION_ERRORS, compute_preview, massing_error_response, preview_arguments
from app.v1.schemas.massing import ErrorResponse
from app.v1.schemas.options import (
    BranchOptionRequest,
    OptionResponse,
    OptionSummaryResponse,
    OptionTreeResponse,
    RootOptionRequest,
)

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
    "/tree",
    response_model=OptionTreeResponse,
    summary="Retrieve a saved option decision tree",
    description=(
        "Return the selected option and all descendants as nested summaries without recomputation. "
        "Children are ordered by ascending creation time, then UUID. A child option can be the selected "
        "root; its stored parent identifier is retained. Leaves have an empty children array."
    ),
    responses={
        404: {"model": ErrorResponse, "description": "Option not found (OPTION_NOT_FOUND)."},
        422: {"model": ErrorResponse, "description": "Missing or malformed root UUID."},
    },
)
async def get_tree(
    root_id: Annotated[UUID, Query()], repository: RepositoryDependency
) -> OptionTreeResponse | JSONResponse:
    tree = await get_option_tree(repository, root_id)
    if tree is None:
        return not_found_response(
            "OPTION_NOT_FOUND", "Option not found.", path="root_id", detail="No saved option has this identifier."
        )
    return _tree_response(tree)


def _tree_response(tree: OptionTree) -> OptionTreeResponse:
    return OptionTreeResponse(
        **OptionSummaryResponse.model_validate(tree.summary, from_attributes=True).model_dump(),
        children=[_tree_response(child) for child in tree.children],
    )


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
        return not_found_response(
            "OPTION_NOT_FOUND", "Option not found.", path="option_id", detail="No saved option has this identifier."
        )
    return OptionResponse.model_validate(snapshot, from_attributes=True)


@router.post(
    "/{option_id}/branches",
    status_code=201,
    response_model=OptionResponse,
    summary="Compute and save an immutable child option",
    description=(
        "Inherit the saved parent site and recompute a complete replacement configuration. "
        "Omitted preferences and targets use empty defaults. All four feasibility statuses can be saved. "
        "Site geometry, parent identifiers, and computed results cannot be supplied in the body."
    ),
    responses={
        201: {
            "headers": {"Location": {"description": "URL of the saved child snapshot.", "schema": {"type": "string"}}}
        },
        404: {"model": ErrorResponse, "description": "Parent option not found (PARENT_OPTION_NOT_FOUND)."},
        422: {"model": ErrorResponse, "description": "Invalid configuration, name, or parent UUID."},
    },
)
async def create_branch_option(
    option_id: UUID, request: BranchOptionRequest, response: Response, repository: RepositoryDependency
) -> OptionResponse | JSONResponse:
    try:
        snapshot = await branch_option(repository, option_id, **preview_arguments(request), name=request.name)
    except ParentOptionNotFound:
        return not_found_response(
            "PARENT_OPTION_NOT_FOUND",
            "Parent option not found.",
            path="option_id",
            detail="No saved parent option has this identifier.",
        )
    except MASSING_VALIDATION_ERRORS as error:
        return massing_error_response(error)
    response.headers["Location"] = f"/api/v1/options/{snapshot.id}"
    return OptionResponse.model_validate(snapshot, from_attributes=True)
