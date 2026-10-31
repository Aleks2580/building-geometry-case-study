"""Read-only, ordered comparisons of complete saved option snapshots."""

from collections.abc import Sequence
from typing import cast
from uuid import UUID

from app.persistence.options import OptionRepository, OptionSnapshot

_CONSTRAINT_FIELDS = (
    "setback_m",
    "floor_to_floor_m",
    "max_height_m",
    "max_floors",
    "site_coverage_ratio",
    "max_footprint_m2",
)
_PREFERENCE_FIELDS = ("preferred_floor_count", "preferred_footprint_area_m2")
_TARGET_FIELDS = ("gfa_target_m2",)
_METRIC_FIELDS = (
    "site_area_m2",
    "buildable_area_m2",
    "selected_buildable_area_m2",
    "footprint_area_upper_bound_m2",
    "gfa_upper_bound_m2",
    "generated_footprint_area_m2",
    "generated_gfa_capacity_m2",
    "maximum_permitted_floor_count",
    "footprint_area_m2",
    "floor_count",
    "height_m",
    "gfa_m2",
    "site_coverage_ratio",
    "floor_to_floor_m",
)


class InvalidComparison(ValueError):
    """A comparison must select exactly two distinct saved option UUIDs."""


class ComparisonOptionNotFound(LookupError):
    def __init__(self, index: int, option_id: UUID) -> None:
        self.index = index
        self.option_id = option_id
        super().__init__("Option not found.")


async def compare_options(repository: OptionRepository, option_ids: Sequence[UUID]) -> dict[str, object]:
    if (
        not isinstance(option_ids, Sequence)
        or len(option_ids) != 2
        or any(not isinstance(option_id, UUID) for option_id in option_ids)
        or option_ids[0] == option_ids[1]
    ):
        raise InvalidComparison("Select exactly two distinct saved option UUIDs.")

    snapshots: list[OptionSnapshot] = []
    for index, option_id in enumerate(option_ids):
        snapshot = await repository.get(option_id)
        if snapshot is None:
            raise ComparisonOptionNotFound(index, option_id)
        snapshots.append(snapshot)
    left, right = snapshots
    left_feasibility = cast(dict[str, object], left.result["feasibility"])
    right_feasibility = cast(dict[str, object], right.result["feasibility"])

    return {
        "options": (left, right),
        "inputs": {
            "site_geometry": _value_pair(left.site_geometry, right.site_geometry),
            "hard_constraints": _numeric_fields(left.hard_constraints, right.hard_constraints, _CONSTRAINT_FIELDS),
            "preferences": _numeric_fields(left.preferences, right.preferences, _PREFERENCE_FIELDS),
            "targets": _numeric_fields(left.targets, right.targets, _TARGET_FIELDS),
        },
        "metrics": _numeric_fields(
            cast(dict[str, object], left.result["metrics"]),
            cast(dict[str, object], right.result["metrics"]),
            _METRIC_FIELDS,
        ),
        "feasibility": {
            "status": _value_pair(left.feasibility_status, right.feasibility_status),
            **{
                field: _value_pair(left_feasibility[field], right_feasibility[field])
                for field in ("reason", "hard_constraints_satisfied", "target_assessment")
            },
        },
        "diagnostics": _value_pair(left_feasibility["diagnostics"], right_feasibility["diagnostics"]),
    }


def _value_pair(left: object, right: object) -> dict[str, object]:
    return {"left": left, "right": right, "changed": left != right}


def _numeric_fields(left: dict[str, object], right: dict[str, object], fields: tuple[str, ...]) -> dict[str, object]:
    comparisons: dict[str, object] = {}
    for field in fields:
        left_value = cast(int | float | None, left[field])
        right_value = cast(int | float | None, right[field])
        # Missing building metrics are unavailable, not zero. Compare stored values
        # exactly; geometry tolerances must not hide historical input/result changes.
        difference = right_value - left_value if left_value is not None and right_value is not None else None
        comparisons[field] = {**_value_pair(left_value, right_value), "difference": difference}
    return comparisons
