from copy import deepcopy
from dataclasses import replace
from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock, call
from uuid import UUID, uuid4

import pytest
from psycopg import AsyncConnection
from shapely.geometry import box

import app.geometry.footprints as footprints
from app.application.comparison import ComparisonOptionNotFound, InvalidComparison, compare_options
from app.application.massing import preview_massing
from app.application.options import branch_option, save_root_option
from app.geometry import FootprintLimits, serialize_site_geometry
from app.massing import DesignPreferences, DesignTargets, FloorLimits
from app.persistence.options import OptionRepository, OptionSnapshot


def _configuration(**overrides):
    return {
        "setback_m": 0,
        "footprint_limits": FootprintLimits(),
        "floor_limits": FloorLimits(3.5, max_floors=6),
        "preferences": DesignPreferences(),
        "targets": DesignTargets(),
        **overrides,
    }


def _snapshot(**overrides):
    preview = preview_massing(serialize_site_geometry(box(0, 0, 40, 25)), **_configuration())
    return OptionSnapshot(
        id=uuid4(),
        parent_id=None,
        name=None,
        schema_version=1,
        algorithm_version="massing-v1;test",
        site_geometry=preview["site"],
        hard_constraints=preview["hard_constraints"],
        preferences=preview["preferences"],
        targets=preview["targets"],
        result=preview,
        feasibility_status="feasible",
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        **overrides,
    )


@pytest.fixture
def repository(monkeypatch):
    repository = Mock(spec=OptionRepository)
    monkeypatch.setattr(
        "app.application.options.preview_massing",
        Mock(side_effect=AssertionError("Comparisons must not recompute geometry.")),
    )
    return repository


@pytest.mark.parametrize(
    "selection",
    [[], [uuid4()], [uuid4(), uuid4(), uuid4()], [UUID(int=1), UUID(int=1)], [uuid4(), "invalid"], "ab", None],
)
async def test_invalid_selection_is_rejected_before_repository_access(repository, selection):
    with pytest.raises(InvalidComparison, match="exactly two distinct"):
        await compare_options(repository, selection)
    assert repository.mock_calls == []


@pytest.mark.parametrize("missing_index", [0, 1])
async def test_missing_option_reports_requested_position_and_stops_reads(repository, missing_index):
    snapshots = [_snapshot(), _snapshot()]
    repository.get = AsyncMock(side_effect=[None] if missing_index == 0 else [snapshots[0], None])
    selection = [snapshot.id for snapshot in snapshots]

    with pytest.raises(ComparisonOptionNotFound) as caught:
        await compare_options(repository, selection)

    assert caught.value.index == missing_index
    assert caught.value.option_id == selection[missing_index]
    assert repository.mock_calls == [call.get(option_id) for option_id in selection[: missing_index + 1]]


async def test_identical_values_return_complete_ordered_snapshots_without_writes_or_mutation(repository):
    left = _snapshot()
    right = replace(deepcopy(left), id=uuid4())
    before = deepcopy((left, right))
    repository.get = AsyncMock(side_effect=[right, left])

    comparison = await compare_options(repository, (right.id, left.id))

    assert comparison["options"] == (right, left)
    assert comparison["inputs"]["site_geometry"] == {
        "left": right.site_geometry,
        "right": left.site_geometry,
        "changed": False,
    }
    assert set(comparison["metrics"]) == set(left.result["metrics"])
    for field, value in left.result["metrics"].items():
        assert comparison["metrics"][field] == {"left": value, "right": value, "changed": False, "difference": 0}
    assert comparison["diagnostics"] == {"left": [], "right": [], "changed": False}
    assert repository.mock_calls == [call.get(right.id), call.get(left.id)]
    assert (left, right) == before


async def test_all_numeric_inputs_metrics_and_site_changes_have_signed_differences(repository):
    left = _snapshot()
    right = replace(deepcopy(left), id=uuid4(), site_geometry=serialize_site_geometry(box(0, 0, 50, 25)))
    for section in ("hard_constraints", "preferences", "targets"):
        for field, value in getattr(right, section).items():
            getattr(right, section)[field] = value + 2 if value is not None else 4
    for field, value in right.result["metrics"].items():
        right.result["metrics"][field] = value + 2 if value is not None else 4
    repository.get = AsyncMock(side_effect=[left, right, right, left])

    forward = await compare_options(repository, [left.id, right.id])
    reverse = await compare_options(repository, [right.id, left.id])

    assert forward["inputs"]["site_geometry"]["changed"] is True
    assert forward["options"] == (left, right)
    assert reverse["options"] == (right, left)
    for section in ("hard_constraints", "preferences", "targets"):
        assert set(forward["inputs"][section]) == set(getattr(left, section))
        for field, left_value in getattr(left, section).items():
            right_value = getattr(right, section)[field]
            assert forward["inputs"][section][field] == {
                "left": left_value,
                "right": right_value,
                "changed": True,
                "difference": 2 if left_value is not None else None,
            }
            assert reverse["inputs"][section][field]["difference"] == (-2 if left_value is not None else None)
    for field in left.result["metrics"]:
        assert forward["metrics"][field]["difference"] == 2
        assert reverse["metrics"][field]["difference"] == -2


@pytest.mark.parametrize("left_value,right_value", [(None, None), (None, 0), (0, None), (0, 7), (2**60, 2**60 + 1)])
async def test_nullable_metrics_and_large_integers_are_not_coerced_to_zero_or_float(
    repository, left_value, right_value
):
    left, right = _snapshot(), _snapshot()
    left.result["metrics"]["gfa_m2"] = left_value
    right.result["metrics"]["gfa_m2"] = right_value
    repository.get = AsyncMock(side_effect=[left, right])

    comparison = await compare_options(repository, [left.id, right.id])

    assert comparison["metrics"]["gfa_m2"] == {
        "left": left_value,
        "right": right_value,
        "changed": left_value != right_value,
        "difference": right_value - left_value if left_value is not None and right_value is not None else None,
    }


async def test_zero_targets_and_small_stored_numeric_changes_remain_visible(repository):
    left, right = _snapshot(), _snapshot()
    left.targets["gfa_target_m2"], right.targets["gfa_target_m2"] = 0, 1
    left.hard_constraints["setback_m"], right.hard_constraints["setback_m"] = 0.3, 0.1 + 0.2
    repository.get = AsyncMock(side_effect=[left, right])

    comparison = await compare_options(repository, [left.id, right.id])

    assert comparison["inputs"]["targets"]["gfa_target_m2"]["difference"] == 1
    assert comparison["inputs"]["hard_constraints"]["setback_m"]["changed"] is True
    assert comparison["inputs"]["hard_constraints"]["setback_m"]["difference"] == (0.1 + 0.2) - 0.3


@pytest.mark.parametrize(
    "replacement",
    [
        {"message": "Updated message"},
        {"severity": "error"},
        {"path": "targets.gfa_target_m2"},
        {"details": {"requested_m2": 2000}},
    ],
)
async def test_diagnostic_comparison_preserves_complete_objects_with_same_code(repository, replacement):
    left, right = _snapshot(), _snapshot()
    diagnostic = {
        "code": "TARGET_EXCEEDS_UPPER_BOUND",
        "severity": "warning",
        "message": "Original message",
        "path": None,
        "details": {"requested_m2": 1000},
    }
    left.result["feasibility"]["diagnostics"] = [diagnostic]
    right.result["feasibility"]["diagnostics"] = [{**diagnostic, **replacement}]
    repository.get = AsyncMock(side_effect=[left, right])

    comparison = await compare_options(repository, [left.id, right.id])

    assert comparison["diagnostics"] == {
        "left": [diagnostic],
        "right": [{**diagnostic, **replacement}],
        "changed": True,
    }


async def test_feasibility_compares_reason_hard_constraint_status_and_complete_target_assessment(repository):
    left, right = _snapshot(), _snapshot()
    right = replace(right, feasibility_status="generation_failed")
    right.result["feasibility"].update(
        reason="FOOTPRINT_NOT_GENERATED",
        hard_constraints_satisfied=None,
        target_assessment={
            "requested_m2": 2000,
            "actual_m2": None,
            "shortfall_m2": None,
            "status": "not_evaluated",
            "diagnostic_code": None,
        },
    )
    repository.get = AsyncMock(side_effect=[left, right])

    comparison = await compare_options(repository, [left.id, right.id])

    assert comparison["feasibility"]["status"] == {
        "left": "feasible",
        "right": "generation_failed",
        "changed": True,
    }
    for field in ("reason", "hard_constraints_satisfied", "target_assessment"):
        assert comparison["feasibility"][field] == {
            "left": left.result["feasibility"][field],
            "right": right.result["feasibility"][field],
            "changed": True,
        }


@pytest.mark.integration
async def test_roots_siblings_and_nested_branches_compare_after_reload_in_read_only_transaction(
    migrated_database, monkeypatch
):
    site = serialize_site_geometry(box(0, 0, 40, 25))
    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        root = await save_root_option(repository, preview_massing(site, **_configuration()))
        other_root = await save_root_option(
            repository,
            preview_massing(serialize_site_geometry(box(0, 0, 50, 25)), **_configuration()),
        )
        first = await branch_option(repository, root.id, **_configuration(targets=DesignTargets(10000)))
        sibling = await branch_option(repository, root.id, **_configuration(setback_m=30))
        with monkeypatch.context() as patch:
            patch.setattr(footprints, "MAX_FOOTPRINT_SEARCH_ITERATIONS", 0)
            nested = await branch_option(
                repository,
                first.id,
                **_configuration(footprint_limits=FootprintLimits(max_footprint_area_m2=500)),
            )
        saved = deepcopy([root, other_root, first, sibling, nested])
        assert [snapshot.feasibility_status for snapshot in saved] == [
            "feasible",
            "feasible",
            "feasible_target_unmet",
            "infeasible",
            "generation_failed",
        ]
        originals = [
            await compare_options(repository, [left.id, right.id])
            for left, right in ((other_root, root), (sibling, first), (root, nested), (nested, sibling))
        ]

    monkeypatch.setattr(
        "app.application.options.preview_massing",
        Mock(side_effect=AssertionError("Reloaded comparisons must use saved snapshots.")),
    )
    async with await AsyncConnection.connect(migrated_database) as connection:
        repository = OptionRepository(connection)
        async with connection.transaction():
            await connection.execute("SET TRANSACTION READ ONLY")
            for expected in originals:
                left, right = expected["options"]
                reloaded = await compare_options(repository, [left.id, right.id])
                assert reloaded == expected
                assert reloaded["options"] == (left, right)
            diagnostic_pair = originals[-1]
            assert diagnostic_pair["metrics"]["gfa_m2"] == {
                "left": None,
                "right": None,
                "changed": False,
                "difference": None,
            }
            assert diagnostic_pair["feasibility"]["status"]["changed"] is True
            assert diagnostic_pair["diagnostics"]["changed"] is True
            assert diagnostic_pair["options"][0].result["footprint_geometry"] is None
            for snapshot in saved:
                assert await repository.get(snapshot.id) == snapshot
            assert len(await repository.list_summaries()) == len(saved)
