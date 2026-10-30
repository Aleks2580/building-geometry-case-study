from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from psycopg import AsyncConnection
from shapely.geometry import box

import app.geometry.footprints as footprints
from app.application.massing import preview_massing
from app.application.options import (
    ALGORITHM_VERSION,
    SCHEMA_VERSION,
    ParentOptionNotFound,
    branch_option,
    save_root_option,
)
from app.geometry import FootprintLimits, serialize_site_geometry
from app.massing import DesignPreferences, DesignTargets, FloorLimits, PreferenceExceedsHardLimit
from app.persistence.options import OptionRepository


def _configuration(**overrides):
    return {
        "setback_m": 0,
        "footprint_limits": FootprintLimits(),
        "floor_limits": FloorLimits(3.5, max_floors=6),
        "preferences": DesignPreferences(),
        "targets": DesignTargets(),
        **overrides,
    }


async def _save_parent(repository, **overrides):
    preview = preview_massing(serialize_site_geometry(box(0, 0, 40, 25)), **_configuration(**overrides))
    return await save_root_option(repository, preview, name="Parent")


async def test_missing_parent_does_not_compute_or_insert(monkeypatch):
    repository = Mock(spec=OptionRepository)
    repository.get = AsyncMock(return_value=None)
    compute = Mock(side_effect=AssertionError("Missing parents must not be computed."))
    monkeypatch.setattr("app.application.options.preview_massing", compute)

    parent_id = uuid4()
    with pytest.raises(ParentOptionNotFound, match="Parent option not found"):
        await branch_option(repository, parent_id, **_configuration())

    repository.get.assert_awaited_once_with(parent_id)
    compute.assert_not_called()
    repository.insert.assert_not_awaited()


async def test_domain_error_is_preserved_without_inserting():
    repository = Mock(spec=OptionRepository)
    repository.get = AsyncMock(return_value=SimpleNamespace(site_geometry=serialize_site_geometry(box(0, 0, 40, 25))))
    with pytest.raises(PreferenceExceedsHardLimit):
        await branch_option(
            repository,
            uuid4(),
            **_configuration(preferences=DesignPreferences(preferred_floor_count=7)),
        )
    repository.insert.assert_not_awaited()


@pytest.mark.integration
async def test_replacement_configuration_siblings_and_nested_branches_reload_unchanged(migrated_database):
    configuration = _configuration(
        setback_m=2,
        footprint_limits=FootprintLimits(site_coverage_ratio=0.6, max_footprint_area_m2=500),
        floor_limits=FloorLimits(3, max_height_m=15, max_floors=4),
        preferences=DesignPreferences(preferred_floor_count=2, preferred_footprint_area_m2=400),
        targets=DesignTargets(gfa_target_m2=750),
    )
    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        parent = await _save_parent(
            repository, preferences=DesignPreferences(preferred_floor_count=5), targets=DesignTargets(4000)
        )
        original = deepcopy(parent)
        expected = preview_massing(parent.site_geometry, **configuration)
        child = await branch_option(repository, parent.id, **configuration, name="Child")
        sibling = await branch_option(repository, parent.id, **_configuration())
        grandchild = await branch_option(repository, child.id, **_configuration())

    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        assert await repository.get(parent.id) == original
        for saved in (child, sibling, grandchild):
            assert await repository.get(saved.id) == saved
            assert saved.site_geometry == original.site_geometry
            assert saved.schema_version == SCHEMA_VERSION
            assert saved.algorithm_version == ALGORITHM_VERSION

    assert len({parent.id, child.id, sibling.id, grandchild.id}) == 4
    assert child.parent_id == sibling.parent_id == parent.id
    assert grandchild.parent_id == child.id
    assert child.name == "Child"
    assert sibling.name is grandchild.name is None
    assert child.result == expected
    for field in ("hard_constraints", "preferences", "targets"):
        assert getattr(child, field) == expected[field]
    assert sibling.preferences == {"preferred_floor_count": None, "preferred_footprint_area_m2": None}
    assert sibling.targets == {"gfa_target_m2": None}
    assert sibling.hard_constraints["max_height_m"] is None
    assert sibling.result["metrics"]["floor_count"] == 6


@pytest.mark.integration
@pytest.mark.parametrize("status", ["feasible", "feasible_target_unmet", "infeasible", "generation_failed"])
async def test_diagnostic_parent_can_branch_to_every_status(migrated_database, monkeypatch, status):
    configuration = _configuration()
    if status == "feasible_target_unmet":
        configuration["targets"] = DesignTargets(10000)
    elif status == "infeasible":
        configuration["setback_m"] = 30
    elif status == "generation_failed":
        configuration["footprint_limits"] = FootprintLimits(max_footprint_area_m2=500)
        monkeypatch.setattr(footprints, "MAX_FOOTPRINT_SEARCH_ITERATIONS", 0)

    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        parent = await _save_parent(repository, setback_m=30)
        assert parent.feasibility_status == "infeasible"
        child = await branch_option(repository, parent.id, **configuration)
        assert await repository.get(child.id) == child
        assert await repository.get(parent.id) == parent

    assert child.parent_id == parent.id
    assert child.feasibility_status == child.result["feasibility"]["status"] == status
    if status in {"infeasible", "generation_failed"}:
        assert child.result["footprint_geometry"] is None
        assert child.result["metrics"]["gfa_m2"] is None
        assert child.result["feasibility"]["diagnostics"]


@pytest.mark.integration
async def test_branch_respects_outer_transaction_rollback(migrated_database):
    class AbortBranch(Exception):
        pass

    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        parent = await _save_parent(repository)
        sibling = await branch_option(repository, parent.id, **_configuration())
        with pytest.raises(AbortBranch):
            async with connection.transaction():
                child = await branch_option(repository, sibling.id, **_configuration())
                assert await repository.get(child.id) == child
                raise AbortBranch
        assert await repository.get(child.id) is None
        assert await repository.get(parent.id) == parent
        assert await repository.get(sibling.id) == sibling
