"""Insert-only option snapshots stored with parameterized PostgreSQL queries."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from psycopg import AsyncConnection
from psycopg.rows import class_row
from psycopg.types.json import Jsonb

type FeasibilityStatus = Literal["feasible", "feasible_target_unmet", "infeasible", "generation_failed"]


@dataclass(frozen=True, slots=True)
class OptionSnapshot:
    id: UUID
    parent_id: UUID | None
    name: str | None
    schema_version: int
    algorithm_version: str
    site_geometry: dict[str, object]
    hard_constraints: dict[str, object]
    preferences: dict[str, object]
    targets: dict[str, object]
    result: dict[str, object]
    feasibility_status: FeasibilityStatus
    created_at: datetime


@dataclass(frozen=True, slots=True)
class OptionSummary:
    id: UUID
    parent_id: UUID | None
    name: str | None
    schema_version: int
    algorithm_version: str
    feasibility_status: FeasibilityStatus
    created_at: datetime
    metrics: dict[str, object]


class OptionRepository:
    def __init__(self, connection: AsyncConnection) -> None:
        self._connection = connection

    async def insert(
        self,
        *,
        site_geometry: dict[str, object],
        hard_constraints: dict[str, object],
        preferences: dict[str, object],
        targets: dict[str, object],
        result: dict[str, object],
        schema_version: int,
        algorithm_version: str,
        name: str | None = None,
        parent_id: UUID | None = None,
    ) -> OptionSnapshot:
        feasibility = result.get("feasibility")
        if not isinstance(feasibility, dict) or "status" not in feasibility:
            raise ValueError("Snapshot result must contain a feasibility status.")

        # A caller's transaction retains commit ownership; psycopg uses a
        # savepoint here when multiple operations must succeed or fail together.
        async with self._connection.transaction():
            async with self._connection.cursor(row_factory=class_row(OptionSnapshot)) as cursor:
                await cursor.execute(
                    """
                    INSERT INTO options (
                        id, parent_id, name, schema_version, algorithm_version,
                        site_geometry, hard_constraints, preferences, targets,
                        result, feasibility_status
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, parent_id, name, schema_version, algorithm_version,
                        site_geometry, hard_constraints, preferences, targets,
                        result, feasibility_status, created_at
                    """,
                    (
                        uuid4(),
                        parent_id,
                        name,
                        schema_version,
                        algorithm_version,
                        Jsonb(site_geometry),
                        Jsonb(hard_constraints),
                        Jsonb(preferences),
                        Jsonb(targets),
                        Jsonb(result),
                        feasibility["status"],
                    ),
                )
                row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("Option insertion did not return a snapshot.")
        return row

    async def get(self, option_id: UUID) -> OptionSnapshot | None:
        async with self._connection.transaction():
            async with self._connection.cursor(row_factory=class_row(OptionSnapshot)) as cursor:
                await cursor.execute(
                    """
                    SELECT id, parent_id, name, schema_version, algorithm_version,
                        site_geometry, hard_constraints, preferences, targets,
                        result, feasibility_status, created_at
                    FROM options WHERE id = %s
                    """,
                    (option_id,),
                )
                row = await cursor.fetchone()
        return row

    async def list_summaries(self, *, limit: int = 50, offset: int = 0) -> list[OptionSummary]:
        if limit <= 0 or offset < 0:
            raise ValueError("Option listing requires a positive limit and non-negative offset.")
        async with self._connection.transaction():
            async with self._connection.cursor(row_factory=class_row(OptionSummary)) as cursor:
                await cursor.execute(
                    """
                    SELECT id, parent_id, name, schema_version, algorithm_version,
                        feasibility_status, created_at, result -> 'metrics' AS metrics
                    FROM options ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s
                    """,
                    (limit, offset),
                )
                rows = await cursor.fetchall()
        return rows

    async def get_descendant_summaries(self, root_id: UUID) -> list[OptionSummary]:
        async with self._connection.transaction():
            async with self._connection.cursor(row_factory=class_row(OptionSummary)) as cursor:
                await cursor.execute(
                    """
                    WITH RECURSIVE descendants AS (
                        SELECT id FROM options WHERE id = %s
                        UNION ALL
                        SELECT child.id FROM options AS child
                        JOIN descendants ON child.parent_id = descendants.id
                    )
                    SELECT option.id, option.parent_id, option.name, option.schema_version,
                        option.algorithm_version, option.feasibility_status, option.created_at,
                        option.result -> 'metrics' AS metrics
                    FROM options AS option JOIN descendants ON option.id = descendants.id
                    ORDER BY option.created_at ASC, option.id ASC
                    """,
                    (root_id,),
                )
                rows = await cursor.fetchall()
        return rows
