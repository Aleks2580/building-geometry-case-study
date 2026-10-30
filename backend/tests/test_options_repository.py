from copy import deepcopy
from dataclasses import FrozenInstanceError
from uuid import uuid4

import pytest
from psycopg import AsyncConnection
from psycopg.errors import ForeignKeyViolation
from shapely.geometry import Polygon, box

import app.geometry.footprints as footprints
from app.application.massing import preview_massing
from app.geometry import FootprintLimits, serialize_site_geometry
from app.massing import DesignPreferences, DesignTargets, FloorLimits
from app.persistence.options import OptionRepository

pytestmark = pytest.mark.integration


def _preview(*, status: str = "feasible", site: Polygon | None = None) -> dict:
    return preview_massing(
        serialize_site_geometry(site if site is not None else box(0, 0, 40, 25)),
        setback_m=30 if status == "infeasible" else 0,
        footprint_limits=FootprintLimits(max_footprint_area_m2=500 if status == "generation_failed" else None),
        floor_limits=FloorLimits(3.5, max_height_m=24, max_floors=6),
        preferences=DesignPreferences(preferred_floor_count=4),
        targets=DesignTargets(10000 if status == "feasible_target_unmet" else 2000),
    )


async def _insert(repository: OptionRepository, result: dict | None = None, **kwargs):
    result = _preview() if result is None else result
    return await repository.insert(
        site_geometry=result["site"],
        hard_constraints=result["hard_constraints"],
        preferences=result["preferences"],
        targets=result["targets"],
        result=result,
        schema_version=1,
        algorithm_version="massing-v1;shapely=2.2.0;geos=test",
        **kwargs,
    )


async def test_insert_commits_complete_snapshot_visible_on_another_connection(migrated_database):
    result = _preview()
    async with await AsyncConnection.connect(migrated_database) as connection:
        saved = await _insert(OptionRepository(connection), result, name="Root option")
        assert connection.info.transaction_status.name == "IDLE"

    async with await AsyncConnection.connect(migrated_database) as connection:
        loaded = await OptionRepository(connection).get(saved.id)

    assert loaded == saved
    assert loaded.parent_id is None
    assert loaded.name == "Root option"
    assert loaded.site_geometry == result["site"]
    assert loaded.hard_constraints == result["hard_constraints"]
    assert loaded.preferences == result["preferences"]
    assert loaded.targets == result["targets"]
    assert loaded.result == result
    assert loaded.schema_version == 1
    assert loaded.algorithm_version == "massing-v1;shapely=2.2.0;geos=test"
    assert loaded.created_at.tzinfo is not None
    with pytest.raises(FrozenInstanceError):
        loaded.name = "Changed"


@pytest.mark.parametrize("status", ["feasible", "feasible_target_unmet", "infeasible", "generation_failed"])
async def test_every_feasibility_status_and_diagnostics_round_trip(migrated_database, monkeypatch, status):
    if status == "generation_failed":
        monkeypatch.setattr(footprints, "MAX_FOOTPRINT_SEARCH_ITERATIONS", 0)
    result = _preview(status=status)
    assert result["feasibility"]["status"] == status
    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        saved = await _insert(repository, result)
        loaded = await repository.get(saved.id)
        summary = (await repository.list_summaries())[0]

    assert loaded.feasibility_status == summary.feasibility_status == status
    assert loaded.result["feasibility"] == result["feasibility"]
    assert loaded.result["footprint_geometry"] == result["footprint_geometry"]
    assert loaded.result["metrics"] == summary.metrics == result["metrics"]
    if status in {"infeasible", "generation_failed"}:
        assert loaded.result["footprint_geometry"] is None
        assert summary.metrics["gfa_m2"] is None
        assert loaded.result["feasibility"]["diagnostics"]


@pytest.mark.parametrize("geometry", ["holes", "split"])
async def test_polygon_holes_and_multipolygon_setbacks_round_trip(migrated_database, geometry):
    if geometry == "holes":
        site = Polygon(box(0, 0, 40.12345678912345, 25).exterior.coords, [box(8, 8, 12, 12).exterior.coords])
        result = _preview(site=site)
        assert len(result["footprint_geometry"]["coordinates"]) == 2
    else:
        site = box(0, 0, 20, 20).union(box(30, 0, 50, 20)).union(box(20, 9, 30, 11))
        result = preview_massing(
            serialize_site_geometry(site),
            setback_m=2,
            footprint_limits=FootprintLimits(),
            floor_limits=FloorLimits(3.5, max_floors=6),
            preferences=DesignPreferences(),
            targets=DesignTargets(),
        )
        assert result["buildable_geometry"]["type"] == "MultiPolygon"
    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        saved = await _insert(repository, result)
        loaded = await repository.get(saved.id)

    assert loaded.result == result
    assert loaded.site_geometry == result["site"]


async def test_mutating_caller_or_loaded_json_never_changes_stored_snapshot(migrated_database):
    result = _preview()
    original = deepcopy(result)
    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        saved = await _insert(repository, result)
        result["metrics"]["gfa_m2"] = -1
        result["hard_constraints"]["max_floors"] = 100
        saved.result["feasibility"]["diagnostics"].append({"code": "CALLER_MUTATION"})
        loaded = await repository.get(saved.id)

    assert loaded.result == original
    assert loaded.hard_constraints == original["hard_constraints"]


async def test_jsonb_preserves_subnormal_lengths_and_arbitrary_integer_floors(migrated_database):
    count = 2**1074
    result = preview_massing(
        serialize_site_geometry(box(0, 0, 1e-160, 1e-160)),
        setback_m=0,
        footprint_limits=FootprintLimits(),
        floor_limits=FloorLimits(5e-324, max_floors=count),
        preferences=DesignPreferences(preferred_floor_count=count),
        targets=DesignTargets(),
    )
    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        saved = await _insert(repository, result)
        loaded = await repository.get(saved.id)

    assert loaded.result == result
    assert loaded.hard_constraints["floor_to_floor_m"] == 5e-324
    assert loaded.result["metrics"]["floor_count"] == count
    assert loaded.result["metrics"]["height_m"] == 1


async def test_outer_transaction_rollback_removes_inserted_snapshot(migrated_database):
    class AbortSave(Exception):
        pass

    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        with pytest.raises(AbortSave):
            async with connection.transaction():
                saved = await _insert(repository)
                assert await repository.get(saved.id) is not None
                raise AbortSave
        assert await repository.get(saved.id) is None
        assert await repository.list_summaries() == []


async def test_failed_insert_rolls_back_savepoint_without_losing_valid_sibling(migrated_database):
    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        async with connection.transaction():
            saved = await _insert(repository)
            with pytest.raises(ForeignKeyViolation):
                await _insert(repository, parent_id=uuid4())
            assert await repository.get(saved.id) == saved
        summaries = await repository.list_summaries()

    assert [summary.id for summary in summaries] == [saved.id]


async def test_existing_parent_is_preserved_by_child_insert(migrated_database):
    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        parent = await _insert(repository, name="Parent")
        child = await _insert(repository, parent_id=parent.id, name="Child")
        reloaded = await repository.get(parent.id)

    assert child.parent_id == parent.id
    assert child.id != parent.id
    assert reloaded == parent


async def test_names_are_parameterized_and_unknown_ids_return_none(migrated_database):
    name = "Root'); DROP TABLE options; --"
    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        saved = await _insert(repository, name=name)
        assert await repository.get(uuid4()) is None
        assert (await repository.get(saved.id)).name == name
        assert len(await repository.list_summaries()) == 1


async def test_summaries_are_bounded_ordered_and_omit_geometry(migrated_database):
    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        # now() is stable within a transaction, exercising the UUID tie-break.
        async with connection.transaction():
            saved = [await _insert(repository, name=f"Option {index}") for index in range(3)]
        ordered = sorted(saved, key=lambda option: (option.created_at, option.id), reverse=True)
        first = await repository.list_summaries(limit=2)
        last = await repository.list_summaries(limit=2, offset=2)
        assert await repository.list_summaries(offset=3) == []

    assert [item.id for item in [*first, *last]] == [item.id for item in ordered]
    assert first[0].metrics == ordered[0].result["metrics"]
    assert not hasattr(first[0], "result")
    assert not hasattr(first[0], "site_geometry")


@pytest.mark.parametrize(("limit", "offset"), [(0, 0), (-1, 0), (1, -1)])
async def test_invalid_pagination_rejected_without_query(migrated_database, limit, offset):
    async with await AsyncConnection.connect(migrated_database) as connection:
        with pytest.raises(ValueError, match="positive limit"):
            await OptionRepository(connection).list_summaries(limit=limit, offset=offset)
        assert connection.info.transaction_status.name == "IDLE"
