"""Save, branch, and read trees of immutable option snapshots."""

import asyncio
from dataclasses import dataclass, field
from typing import cast
from uuid import UUID

import shapely

from app.application.massing import preview_massing
from app.geometry import FootprintLimits
from app.massing import DesignPreferences, DesignTargets, FloorLimits
from app.persistence.options import OptionRepository, OptionSnapshot, OptionSummary

SCHEMA_VERSION = 1
# Bump the policy version when massing behavior changes. Engine versions preserve
# the numerical context of historical snapshots without promising recomputation.
ALGORITHM_VERSION = f"massing-v1;shapely={shapely.__version__};geos={shapely.geos_version_string}"


class ParentOptionNotFound(LookupError):
    """No saved parent exists for a requested branch."""


@dataclass(slots=True)
class OptionTree:
    summary: OptionSummary
    children: list["OptionTree"] = field(default_factory=list)


async def get_option_tree(repository: OptionRepository, root_id: UUID) -> OptionTree | None:
    summaries = await repository.get_descendant_summaries(root_id)
    nodes = {summary.id: OptionTree(summary) for summary in summaries}
    # Transaction timestamps can tie, so UUID ordering may put a child before its
    # parent. Allocate every node before linking; the requested root may be a child.
    for summary in sorted(summaries, key=lambda item: (item.created_at, item.id)):
        if summary.id != root_id and summary.parent_id is not None:
            nodes[summary.parent_id].children.append(nodes[summary.id])
    return nodes.get(root_id)


async def save_root_option(
    repository: OptionRepository,
    preview: dict[str, object],
    *,
    name: str | None = None,
) -> OptionSnapshot:
    return await _save_option(repository, preview, name=name)


async def branch_option(
    repository: OptionRepository,
    parent_id: UUID,
    *,
    setback_m: float,
    footprint_limits: FootprintLimits,
    floor_limits: FloorLimits,
    preferences: DesignPreferences,
    targets: DesignTargets,
    name: str | None = None,
) -> OptionSnapshot:
    """Recompute an inherited site with complete replacement configuration."""
    parent = await repository.get(parent_id)
    if parent is None:
        raise ParentOptionNotFound("Parent option not found.")
    preview = await asyncio.to_thread(
        preview_massing,
        parent.site_geometry,
        setback_m=setback_m,
        footprint_limits=footprint_limits,
        floor_limits=floor_limits,
        preferences=preferences,
        targets=targets,
    )
    return await _save_option(repository, preview, name=name, parent_id=parent.id)


async def _save_option(
    repository: OptionRepository,
    preview: dict[str, object],
    *,
    name: str | None = None,
    parent_id: UUID | None = None,
) -> OptionSnapshot:
    return await repository.insert(
        site_geometry=cast(dict[str, object], preview["site"]),
        hard_constraints=cast(dict[str, object], preview["hard_constraints"]),
        preferences=cast(dict[str, object], preview["preferences"]),
        targets=cast(dict[str, object], preview["targets"]),
        result=preview,
        schema_version=SCHEMA_VERSION,
        algorithm_version=ALGORITHM_VERSION,
        name=name,
        parent_id=parent_id,
    )
