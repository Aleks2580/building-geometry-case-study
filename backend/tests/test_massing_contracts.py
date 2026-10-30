import json
from copy import deepcopy
from math import nextafter

import pytest
from pydantic import ValidationError

from app.v1.schemas.massing import (
    DesignPreferences,
    DesignTargets,
    HardConstraints,
    MassingPreviewRequest,
    MassingPreviewResponse,
    MultiPolygonGeometry,
    PolygonGeometry,
)


def _request() -> dict:
    return {
        "site": {"type": "Polygon", "coordinates": [[[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]]]},
        "hard_constraints": {"setback_m": 3, "floor_to_floor_m": 3.5, "max_floors": 6},
    }


def _response(status: str = "feasible") -> dict:
    request = _request()
    geometry = request["site"]
    return {
        **request,
        "site_geometry": geometry,
        "buildable_geometry": geometry,
        "selected_buildable_geometry": geometry,
        "generated_footprint_geometry": geometry,
        "footprint_geometry": geometry,
        "floor_plate_geometry": geometry,
        "metrics": {
            "site_area_m2": 1000,
            "buildable_area_m2": 1000,
            "selected_buildable_area_m2": 1000,
            "footprint_area_upper_bound_m2": 1000,
            "gfa_upper_bound_m2": 6000,
            "generated_footprint_area_m2": 1000,
            "generated_gfa_capacity_m2": 6000,
            "maximum_permitted_floor_count": 6,
            "footprint_area_m2": 1000,
            "floor_count": 6,
            "height_m": 21,
            "gfa_m2": 6000,
            "site_coverage_ratio": 1,
            "floor_to_floor_m": 3.5,
        },
        "setback": {"component_count": 1, "retained_area_m2": 1000, "discarded_area_m2": 0},
        "preference_results": {"preferred_floor_count": None, "footprint_area": None},
        "feasibility": {
            "status": status,
            "reason": None,
            "hard_constraints_satisfied": True,
            "target_assessment": {
                "requested_m2": None,
                "actual_m2": 6000,
                "shortfall_m2": None,
                "status": "not_requested",
                "diagnostic_code": None,
            },
            "diagnostics": [],
        },
    }


def test_request_defaults_optional_objects_and_preserves_integer_coordinates() -> None:
    payload = _request()
    payload["site"]["coordinates"][0][0][0] = 2**70 + 1

    request = MassingPreviewRequest.model_validate(payload)

    assert request.preferences == DesignPreferences()
    assert request.targets == DesignTargets()
    assert request.site.coordinates[0][0][0] == 2**70 + 1
    assert isinstance(request.site.coordinates[0][0][0], int)
    assert request.hard_constraints.setback_m == 3.0


def test_integer_floor_counts_are_not_limited_by_float_precision() -> None:
    maximum = 2**1074
    constraints = HardConstraints(setback_m=0, floor_to_floor_m=1, max_floors=maximum)
    preferences = DesignPreferences(preferred_floor_count=maximum)

    assert constraints.max_floors == maximum
    assert preferences.preferred_floor_count == maximum
    assert json.loads(constraints.model_dump_json())["max_floors"] == maximum


@pytest.mark.parametrize("field", ["preferred_floor_count", "preferred_footprint_area_m2"])
@pytest.mark.parametrize("value", [True, "2", 0, -1, float("inf"), float("nan")])
def test_preferences_reject_malformed_and_non_positive_values(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        DesignPreferences.model_validate({field: value})


@pytest.mark.parametrize("value", [2.0, 2.5])
def test_floor_count_rejects_floats(value: float) -> None:
    with pytest.raises(ValidationError):
        HardConstraints.model_validate({"setback_m": 0, "floor_to_floor_m": 3, "max_floors": value})
    with pytest.raises(ValidationError):
        DesignPreferences.model_validate({"preferred_floor_count": value})


@pytest.mark.parametrize("value", [True, "0", -1, float("inf"), float("nan")])
def test_targets_require_finite_non_negative_numeric_values(value: object) -> None:
    with pytest.raises(ValidationError):
        DesignTargets.model_validate({"gfa_target_m2": value})


def test_zero_and_null_targets_are_supported() -> None:
    assert DesignTargets(gfa_target_m2=0).gfa_target_m2 == 0.0
    assert DesignTargets(gfa_target_m2=None).gfa_target_m2 is None


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("setback_m", -1),
        ("setback_m", True),
        ("floor_to_floor_m", 0),
        ("floor_to_floor_m", "3"),
        ("max_height_m", 0),
        ("max_floors", 0),
        ("max_footprint_m2", 0),
        ("site_coverage_ratio", 0),
        ("site_coverage_ratio", 1.0001),
        ("max_height_m", float("inf")),
    ],
)
def test_hard_constraint_bounds_and_types(field: str, value: object) -> None:
    payload = {"setback_m": 0, "floor_to_floor_m": 3, "max_floors": 6, field: value}
    with pytest.raises(ValidationError):
        HardConstraints.model_validate(payload)


def test_height_or_floor_cap_is_required() -> None:
    with pytest.raises(ValidationError, match="At least one"):
        HardConstraints(setback_m=0, floor_to_floor_m=3)
    assert HardConstraints(setback_m=0, floor_to_floor_m=3, max_height_m=12).max_floors is None


@pytest.mark.parametrize("field", ["preferences", "targets"])
def test_optional_objects_reject_explicit_null(field: str) -> None:
    payload = _request()
    payload[field] = None
    with pytest.raises(ValidationError):
        MassingPreviewRequest.model_validate(payload)


@pytest.mark.parametrize("field", [None, "site", "hard_constraints", "preferences", "targets"])
def test_request_rejects_unknown_fields(field: str | None) -> None:
    payload = _request()
    if field is None:
        payload["result"] = {}
    else:
        payload.setdefault(field, {})["unknown"] = 1
    with pytest.raises(ValidationError):
        MassingPreviewRequest.model_validate(payload)


@pytest.mark.parametrize("ordinate", [True, "1", float("inf"), float("nan")])
def test_site_coordinates_reject_non_numeric_and_non_finite_values(ordinate: object) -> None:
    payload = _request()
    payload["site"]["coordinates"][0][0][0] = ordinate
    with pytest.raises(ValidationError):
        MassingPreviewRequest.model_validate(payload)


@pytest.mark.parametrize("position", [[0], [0, 0, 0]])
def test_site_positions_require_exactly_two_ordinates(position: list[int]) -> None:
    payload = _request()
    payload["site"]["coordinates"][0][0] = position
    with pytest.raises(ValidationError):
        MassingPreviewRequest.model_validate(payload)


def test_holes_and_multipolygon_setback_serialization() -> None:
    exterior = [[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]]
    hole = [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]]
    polygon = PolygonGeometry(type="Polygon", coordinates=[exterior, hole])
    multi = MultiPolygonGeometry(type="MultiPolygon", coordinates=[polygon.coordinates, [exterior]])
    payload = _response()
    payload["site_geometry"] = polygon.model_dump()
    payload["buildable_geometry"] = multi.model_dump()

    serialized = json.loads(MassingPreviewResponse.model_validate(payload).model_dump_json())

    assert len(serialized["site_geometry"]["coordinates"]) == 2
    assert serialized["buildable_geometry"]["type"] == "MultiPolygon"
    assert len(serialized["buildable_geometry"]["coordinates"]) == 2


@pytest.mark.parametrize("status", ["feasible", "feasible_target_unmet", "infeasible", "generation_failed"])
def test_response_supports_every_feasibility_status(status: str) -> None:
    payload = _response(status)
    if status in {"infeasible", "generation_failed"}:
        for field in [
            "buildable_geometry",
            "selected_buildable_geometry",
            "footprint_geometry",
            "floor_plate_geometry",
        ]:
            payload[field] = None
        for field in ["footprint_area_m2", "floor_count", "height_m", "gfa_m2", "site_coverage_ratio"]:
            payload["metrics"][field] = None
        payload["feasibility"]["hard_constraints_satisfied"] = False if status == "infeasible" else None
        payload["feasibility"]["target_assessment"]["actual_m2"] = None

    result = MassingPreviewResponse.model_validate(payload)

    assert result.feasibility.status == status
    assert json.loads(result.model_dump_json())["footprint_geometry"] == payload["footprint_geometry"]


@pytest.mark.parametrize("value", [float("inf"), float("nan")])
def test_response_rejects_non_finite_metrics(value: float) -> None:
    payload = _response()
    payload["metrics"]["height_m"] = value
    with pytest.raises(ValidationError):
        MassingPreviewResponse.model_validate(payload)


def test_json_round_trip_preserves_double_precision() -> None:
    payload = _response()
    ordinate = nextafter(40.0, float("inf"))
    area = nextafter(1000.0, float("inf"))
    payload["site_geometry"] = deepcopy(payload["site_geometry"])
    payload["site_geometry"]["coordinates"][0][1][0] = ordinate
    payload["metrics"]["site_area_m2"] = area

    result = json.loads(MassingPreviewResponse.model_validate(payload).model_dump_json())

    assert result["site_geometry"]["coordinates"][0][1][0] == ordinate
    assert result["metrics"]["site_area_m2"] == area


def test_openapi_models_describe_discriminated_nullable_geometry_and_statuses() -> None:
    schema = MassingPreviewResponse.model_json_schema()
    geometry_schema = schema["properties"]["buildable_geometry"]

    assert geometry_schema["anyOf"][0]["discriminator"]["propertyName"] == "type"
    assert {"type": "null"} in geometry_schema["anyOf"]
    assert schema["$defs"]["MassingFeasibility"]["properties"]["status"]["enum"] == [
        "feasible",
        "feasible_target_unmet",
        "infeasible",
        "generation_failed",
    ]
