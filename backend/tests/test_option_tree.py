from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest
from psycopg import AsyncConnection
from shapely.geometry import box

import app.geometry.footprints as footprints
from app.application.massing import preview_massing
from app.application.options import get_option_tree
from app.geometry import FootprintLimits, serialize_site_geometry
from app.massing import DesignPreferences, DesignTargets, FloorLimits
from app.persistence.options import OptionRepository, OptionSummary


def _summary(identifier, parent_id=None, *, days=0):
    return OptionSummary(
        id=UUID(int=identifier),
        parent_id=parent_id,
        name=f"Option {identifier}",
        schema_version=1,
        algorithm_version="massing-v1;test",
        feasibility_status="feasible",
        created_at=datetime(2026, 1, 1, tzinfo=UTC) + timedelta(days=days),
        metrics={"gfa_m2": 2000},
    )


@pytest.fixture
def repository(monkeypatch):
    repository = Mock(spec=OptionRepository)
    repository.get_descendant_summaries = AsyncMock(return_value=[])
    monkeypatch.setattr(
        "app.application.options.preview_massing",
        Mock(side_effect=AssertionError("Tree retrieval must not recompute saved options.")),
    )
    return repository


async def test_missing_tree_uses_one_summary_query_without_snapshot_reads_or_writes(repository):
    root_id = uuid4()
    assert await get_option_tree(repository, root_id) is None
    repository.get_descendant_summaries.assert_awaited_once_with(root_id)
    repository.get.assert_not_awaited()
    repository.insert.assert_not_awaited()
    repository.list_summaries.assert_not_awaited()


@pytest.mark.parametrize("parent_id", [None, UUID(int=999)])
async def test_root_only_tree_preserves_summary_and_subtree_parent(repository, parent_id):
    root = _summary(100, parent_id)
    repository.get_descendant_summaries.return_value = [root]

    tree = await get_option_tree(repository, root.id)

    assert tree.summary == root
    assert tree.children == []
    repository.get_descendant_summaries.assert_awaited_once_with(root.id)
    repository.get.assert_not_awaited()
    repository.insert.assert_not_awaited()


async def test_tree_assembles_unsorted_rows_with_stable_sibling_and_nested_order(repository):
    root = _summary(100)
    first = _summary(20, root.id)
    second = _summary(30, root.id)
    later = _summary(40, root.id, days=1)
    nested_first = _summary(10, second.id)
    nested_second = _summary(50, second.id)
    repository.get_descendant_summaries.return_value = [
        later,
        nested_second,
        root,
        second,
        nested_first,
        first,
    ]

    tree = await get_option_tree(repository, root.id)

    assert tree.summary == root
    assert [child.summary for child in tree.children] == [first, second, later]
    assert [child.summary for child in tree.children[1].children] == [nested_first, nested_second]
    assert tree.children[0].children == tree.children[2].children == []
    assert all(child.children == [] for child in tree.children[1].children)
    repository.get_descendant_summaries.assert_awaited_once_with(root.id)
    repository.get.assert_not_awaited()
    repository.insert.assert_not_awaited()
    repository.list_summaries.assert_not_awaited()


def _preview(status="feasible"):
    return preview_massing(
        serialize_site_geometry(box(0, 0, 40, 25)),
        setback_m=30 if status == "infeasible" else 0,
        footprint_limits=FootprintLimits(max_footprint_area_m2=500 if status == "generation_failed" else None),
        floor_limits=FloorLimits(3.5, max_floors=6),
        preferences=DesignPreferences(preferred_floor_count=4),
        targets=DesignTargets(10000 if status == "feasible_target_unmet" else 2000),
    )


async def _insert(repository, preview, *, parent_id=None):
    return await repository.insert(
        site_geometry=preview["site"],
        hard_constraints=preview["hard_constraints"],
        preferences=preview["preferences"],
        targets=preview["targets"],
        result=preview,
        schema_version=1,
        algorithm_version="massing-v1;test",
        parent_id=parent_id,
    )


@pytest.mark.integration
async def test_repository_root_only_and_missing_tree(migrated_database):
    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        root = await _insert(repository, _preview())

        summaries = await repository.get_descendant_summaries(root.id)
        assert [summary.id for summary in summaries] == [root.id]
        assert summaries[0].parent_id is None
        assert summaries[0].metrics == root.result["metrics"]
        tree = await get_option_tree(repository, root.id)
        assert tree.summary == summaries[0]
        assert tree.children == []
        assert await repository.get_descendant_summaries(uuid4()) == []
        assert await get_option_tree(repository, uuid4()) is None
        assert connection.info.transaction_status.name == "IDLE"


@pytest.mark.integration
async def test_tree_reloads_lightweight_isolated_descendants_without_changing_snapshots(migrated_database, monkeypatch):
    previews = {status: _preview(status) for status in ("feasible", "feasible_target_unmet", "infeasible")}
    with monkeypatch.context() as patch:
        patch.setattr(footprints, "MAX_FOOTPRINT_SEARCH_ITERATIONS", 0)
        previews["generation_failed"] = _preview("generation_failed")
    assert all(preview["feasibility"]["status"] == status for status, preview in previews.items())
    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        # A shared transaction timestamp forces UUID ordering at every level.
        async with connection.transaction():
            root = await _insert(repository, previews["feasible"])
            first = await _insert(repository, previews["feasible_target_unmet"], parent_id=root.id)
            second = await _insert(repository, previews["infeasible"], parent_id=root.id)
            nested = await _insert(repository, previews["generation_failed"], parent_id=first.id)
            independent = await _insert(repository, previews["feasible"])
            independent_child = await _insert(repository, previews["feasible"], parent_id=independent.id)
        original = [root, first, second, nested, independent, independent_child]

    monkeypatch.setattr(
        "app.application.options.preview_massing",
        Mock(side_effect=AssertionError("Reloaded trees must use stored metrics.")),
    )
    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        async with connection.transaction():
            await connection.execute("SET TRANSACTION READ ONLY")
            summaries = await repository.get_descendant_summaries(root.id)
            assert [summary.id for summary in summaries] == [
                saved.id
                for saved in sorted([root, first, second, nested], key=lambda saved: (saved.created_at, saved.id))
            ]
            by_id = {saved.id: saved for saved in original}
            for summary in summaries:
                saved = by_id[summary.id]
                assert summary.metrics == saved.result["metrics"]
                assert summary.feasibility_status == saved.feasibility_status
                assert summary.parent_id == saved.parent_id
                assert not hasattr(summary, "result")
                assert not hasattr(summary, "site_geometry")
            assert next(summary for summary in summaries if summary.id == second.id).metrics["gfa_m2"] is None
            assert next(summary for summary in summaries if summary.id == nested.id).metrics["gfa_m2"] is None

            tree = await get_option_tree(repository, root.id)
            assert tree.summary.id == root.id
            assert [child.summary.id for child in tree.children] == sorted([first.id, second.id])
            first_node = next(child for child in tree.children if child.summary.id == first.id)
            assert [child.summary.id for child in first_node.children] == [nested.id]
            assert first_node.children[0].children == []

            subtree = await get_option_tree(repository, first.id)
            assert subtree == first_node
            assert subtree.summary.parent_id == root.id
            independent_tree = await get_option_tree(repository, independent.id)
            assert independent_tree.summary.id == independent.id
            assert [child.summary.id for child in independent_tree.children] == [independent_child.id]
            assert independent_tree.children[0].children == []
            for saved in original:
                assert await repository.get(saved.id) == saved
