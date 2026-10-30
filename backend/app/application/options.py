"""Save complete server-computed previews as immutable root snapshots."""

from typing import cast

import shapely

from app.persistence.options import OptionRepository, OptionSnapshot

SCHEMA_VERSION = 1
# Bump the policy version when massing behavior changes. Engine versions preserve
# the numerical context of historical snapshots without promising recomputation.
ALGORITHM_VERSION = f"massing-v1;shapely={shapely.__version__};geos={shapely.geos_version_string}"


async def save_root_option(
    repository: OptionRepository,
    preview: dict[str, object],
    *,
    name: str | None = None,
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
    )
