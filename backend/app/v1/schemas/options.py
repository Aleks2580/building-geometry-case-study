from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, StringConstraints

from app.v1.schemas.massing import (
    ContractModel,
    DesignPreferences,
    DesignTargets,
    HardConstraints,
    MassingMetrics,
    MassingPreviewRequest,
    MassingPreviewResponse,
    PolygonGeometry,
    PositiveInteger,
)


class RootOptionRequest(MassingPreviewRequest):
    # PostgreSQL text cannot store NUL; reject it before an otherwise valid save.
    name: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200, pattern=r"^[^\x00]+$")]
        | None
    ) = None


class OptionMetadata(ContractModel):
    id: UUID
    parent_id: UUID | None
    name: str | None
    schema_version: PositiveInteger
    algorithm_version: str
    feasibility_status: Literal["feasible", "feasible_target_unmet", "infeasible", "generation_failed"]
    created_at: AwareDatetime


class OptionResponse(OptionMetadata):
    site_geometry: PolygonGeometry
    hard_constraints: HardConstraints
    preferences: DesignPreferences
    targets: DesignTargets
    result: MassingPreviewResponse


class OptionSummaryResponse(OptionMetadata):
    metrics: MassingMetrics
