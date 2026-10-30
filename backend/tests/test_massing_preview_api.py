import json
from math import nextafter

import pytest
from httpx import ASGITransport, AsyncClient
from shapely.errors import GEOSException
from shapely.geometry import box, shape

import app.geometry.footprints as footprints
from app.config import Config
from app.geometry import serialize_site_geometry
from app.server import create_app

PREVIEW_URL = "/api/v1/massing/preview"


@pytest.fixture
def payload():
    return {
        "site": {"type": "Polygon", "coordinates": [[[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]]]},
        "hard_constraints": {"setback_m": 3, "floor_to_floor_m": 3.5, "max_height_m": 24, "max_floors": 6},
    }


@pytest.fixture
async def client():
    app = create_app(Config(debug=False))
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test"
    ) as client:
        yield client


async def test_preview_returns_server_computed_geometry_and_capacity(client, payload):
    payload["hard_constraints"]["max_footprint_m2"] = 500
    payload["preferences"] = {"preferred_floor_count": 4}
    payload["targets"] = {"gfa_target_m2": 3000}
    response = await client.post(PREVIEW_URL, json=payload)

    assert response.status_code == 200
    body = response.json()
    metrics = body["metrics"]
    assert body["hard_constraints"]["max_footprint_m2"] == 500
    assert "max_footprint_area_m2" not in body["hard_constraints"]
    assert metrics["site_area_m2"] == 1000
    assert metrics["buildable_area_m2"] == 646
    assert metrics["footprint_area_upper_bound_m2"] == 500
    assert metrics["gfa_upper_bound_m2"] == 3000
    assert metrics["maximum_permitted_floor_count"] == 6
    assert metrics["floor_count"] == 4
    assert metrics["height_m"] == 14
    assert metrics["footprint_area_m2"] <= 500
    assert metrics["gfa_m2"] == metrics["footprint_area_m2"] * 4
    assert metrics["generated_gfa_capacity_m2"] == metrics["generated_footprint_area_m2"] * 6
    assert shape(body["footprint_geometry"]).area == metrics["footprint_area_m2"]
    assert body["floor_plate_geometry"] == body["footprint_geometry"]
    assert body["feasibility"]["status"] == "feasible_target_unmet"
    assert body["feasibility"]["hard_constraints_satisfied"] is True
    target = body["feasibility"]["target_assessment"]
    assert target["requested_m2"] == 3000
    assert target["actual_m2"] == metrics["gfa_m2"]
    assert target["shortfall_m2"] == 3000 - metrics["gfa_m2"]


@pytest.mark.parametrize(
    "target,expected_floors,target_status", [(None, 6, "not_requested"), (0, 6, "met"), (2000, 4, "met")]
)
async def test_preview_defaults_and_target_floor_selection(client, payload, target, expected_floors, target_status):
    if target is not None:
        payload["targets"] = {"gfa_target_m2": target}
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["floor_count"] == expected_floors
    assert body["feasibility"]["status"] == "feasible"
    assert body["feasibility"]["target_assessment"]["status"] == target_status


@pytest.mark.parametrize("zero_floors", [False, True])
async def test_infeasibility_returns_null_building_and_preserves_context(client, payload, zero_floors):
    payload["targets"] = {"gfa_target_m2": 0}
    payload["preferences"] = {"preferred_floor_count": 100}
    if zero_floors:
        payload["hard_constraints"] = {"setback_m": 0, "floor_to_floor_m": 3.5, "max_height_m": 3}
    else:
        payload["hard_constraints"]["setback_m"] = 13
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["site_geometry"] is not None
    assert (body["buildable_geometry"] is not None) == zero_floors
    for name in ("generated_footprint_geometry", "footprint_geometry", "floor_plate_geometry"):
        assert body[name] is None
    for name in ("footprint_area_m2", "floor_count", "height_m", "gfa_m2", "generated_gfa_capacity_m2"):
        assert body["metrics"][name] is None
    feasibility = body["feasibility"]
    assert feasibility["status"] == "infeasible"
    assert feasibility["hard_constraints_satisfied"] is False
    assert feasibility["reason"] == ("ZERO_PERMITTED_FLOORS" if zero_floors else "EMPTY_BUILDABLE_REGION")
    assert feasibility["target_assessment"]["status"] == "not_evaluated"


async def test_generation_failure_is_a_200_outcome(client, payload, monkeypatch):
    monkeypatch.setattr(footprints, "_buffer_candidate", lambda *args: None)
    payload["hard_constraints"]["max_footprint_m2"] = 100
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["feasibility"]["status"] == "generation_failed"
    assert body["feasibility"]["hard_constraints_satisfied"] is None
    assert body["feasibility"]["reason"] == "FOOTPRINT_NOT_GENERATED"
    assert body["footprint_geometry"] is None
    assert body["metrics"]["gfa_m2"] is None
    assert body["metrics"]["footprint_area_upper_bound_m2"] == 100


async def test_holes_and_split_setbacks_survive_response_validation(client, payload):
    payload["site"] = {
        "type": "Polygon",
        "coordinates": [
            [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]],
            [[5, 5], [5, 10], [10, 10], [10, 5], [5, 5]],
        ],
    }
    payload["hard_constraints"]["setback_m"] = 0
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 200
    body = response.json()
    assert len(body["footprint_geometry"]["coordinates"]) == 2
    assert body["metrics"]["footprint_area_m2"] == 375

    site = box(0, 0, 20, 20).union(box(30, 0, 50, 20)).union(box(20, 9, 30, 11))
    payload["site"] = serialize_site_geometry(site)
    payload["hard_constraints"]["setback_m"] = 2
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["buildable_geometry"]["type"] == "MultiPolygon"
    assert body["selected_buildable_geometry"]["type"] == "Polygon"
    assert body["setback"]["component_count"] == 2
    assert body["setback"]["discarded_area_m2"] > 0
    assert "BUILDABLE_REGION_SPLIT" in [item["code"] for item in body["feasibility"]["diagnostics"]]


async def test_area_preference_keeps_requested_effective_and_actual_values(client, payload):
    payload["hard_constraints"]["max_footprint_m2"] = 400
    payload["preferences"] = {"preferred_footprint_area_m2": 500}
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 200
    body = response.json()
    area = body["preference_results"]["footprint_area"]
    assert area["status"] == "clamped"
    assert area["requested_area_m2"] == 500
    assert area["effective_target_m2"] == 400
    assert area["actual_area_m2"] == body["metrics"]["footprint_area_m2"]
    assert area["difference_m2"] == area["actual_area_m2"] - 500
    assert "PREFERENCE_CLAMPED_TO_HARD_CAP" in area["diagnostic_codes"]


@pytest.mark.parametrize(
    "section,field,value,code",
    [
        ("hard_constraints", "setback_m", -1, "INVALID_CONSTRAINTS"),
        ("hard_constraints", "floor_to_floor_m", 0, "INVALID_CONSTRAINTS"),
        ("hard_constraints", "max_floors", 2.0, "INVALID_CONSTRAINTS"),
        ("hard_constraints", "max_floors", True, "INVALID_CONSTRAINTS"),
        ("hard_constraints", "max_footprint_m2", "100", "INVALID_CONSTRAINTS"),
        ("hard_constraints", "max_footprint_area_m2", 100, "INVALID_CONSTRAINTS"),
        ("hard_constraints", "site_coverage_ratio", 1.1, "INVALID_CONSTRAINTS"),
        ("preferences", "preferred_floor_count", 0, "INVALID_PREFERENCE"),
        ("preferences", "preferred_floor_count", 7, "PREFERENCE_EXCEEDS_HARD_LIMIT"),
        ("preferences", "preferred_footprint_area_m2", -1, "INVALID_PREFERENCE"),
        ("targets", "gfa_target_m2", -1, "INVALID_TARGET"),
        ("targets", "gfa_target_m2", True, "INVALID_TARGET"),
        ("targets", "gfa_target_m2", "1000", "INVALID_TARGET"),
    ],
)
async def test_invalid_fields_have_structured_errors(client, payload, section, field, value, code):
    payload.setdefault(section, {})[field] = value
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == code
    assert error["details"][0]["path"] == f"{section}.{field}"
    assert error["details"][0]["message"]
    assert "input" not in error["details"][0]


@pytest.mark.parametrize(
    "section,code",
    [
        ("site", "INVALID_SITE_GEOMETRY"),
        ("hard_constraints", "INVALID_CONSTRAINTS"),
        ("preferences", "INVALID_PREFERENCE"),
        ("targets", "INVALID_TARGET"),
    ],
)
async def test_null_sections_rejected(client, payload, section, code):
    payload[section] = None
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code


async def test_missing_floor_limits_and_computed_input_are_rejected(client, payload):
    del payload["hard_constraints"]["max_floors"]
    del payload["hard_constraints"]["max_height_m"]
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_CONSTRAINTS"

    payload["hard_constraints"]["max_floors"] = 6
    payload["metrics"] = {"gfa_m2": 1}
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize(
    "coordinates",
    [
        [[[0, 0], [10, 0], [0, 10], [10, 10], [0, 0]]],
        [[[0, 0], [10, 0], [10, 10], [0, 10]]],
        [[[0, 0], [1, 0], [2, 0], [0, 0]]],
        [[[0, 0], [10, 0], [10, 10], [0, 10], [False, 0]]],
        [[[2**60, 0], [2**60 + 1024, 0], [2**60 + 1024, 1024], [2**60, 1024], [2**60 + 1, 0]]],
    ],
)
async def test_invalid_geometry_is_422_without_repair(client, payload, coordinates):
    payload["site"]["coordinates"] = coordinates
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "INVALID_SITE_GEOMETRY"
    assert error["details"][0]["path"].startswith("site.coordinates")


async def test_nonfinite_input_and_malformed_json_return_json_errors(client, payload):
    for value in (float("nan"), float("inf"), -float("inf"), 10**400):
        payload["targets"] = {"gfa_target_m2": value}
        response = await client.post(
            PREVIEW_URL, content=json.dumps(payload), headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "INVALID_TARGET"
    response = await client.post(PREVIEW_URL, content="{", headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


async def test_coordinate_error_paths_exclude_validation_branch_labels(client, payload):
    payload["site"]["coordinates"][0][0][0] = False
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 422
    assert {item["path"] for item in response.json()["error"]["details"]} == {"site.coordinates[0][0][0]"}


async def test_floor_limit_binary64_precision_is_preserved(client, payload):
    payload["hard_constraints"] = {"setback_m": 0, "floor_to_floor_m": 3.6, "max_height_m": 36}
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 200
    assert response.json()["metrics"]["floor_count"] == 9
    payload["hard_constraints"]["max_height_m"] = nextafter(36, float("inf"))
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 200
    assert response.json()["metrics"]["floor_count"] == 10


async def test_unreportable_metric_returns_range_error(client, payload):
    payload["hard_constraints"] = {"setback_m": 0, "floor_to_floor_m": 3.5, "max_floors": 10**309}
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "NUMERICAL_RANGE_ERROR"


async def test_unexpected_geometry_failure_remains_a_server_error(client, payload, monkeypatch):
    def fail(*args, **kwargs):
        raise GEOSException("Unexpected engine failure")

    monkeypatch.setattr(footprints, "generate_footprint", fail)
    monkeypatch.setattr("app.massing.defaults.generate_footprint", fail)
    response = await client.post(PREVIEW_URL, json=payload)
    assert response.status_code == 500
    assert "Unexpected engine failure" not in response.text


async def test_openapi_documents_preview_models_and_error_envelope(client):
    schema = create_app(Config()).openapi()
    endpoint = schema["paths"][PREVIEW_URL]["post"]
    assert endpoint["requestBody"]["required"] is True
    assert endpoint["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "MassingPreviewResponse"
    )
    assert endpoint["responses"]["422"]["content"]["application/json"]["schema"]["$ref"].endswith("ErrorResponse")
    models = schema["components"]["schemas"]
    assert models["MassingFeasibility"]["properties"]["status"]["enum"] == [
        "feasible",
        "feasible_target_unmet",
        "infeasible",
        "generation_failed",
    ]
    assert models["MassingPreviewRequest"]["additionalProperties"] is False
    assert models["PolygonGeometry"]["properties"]["coordinates"]
    assert "MultiPolygonGeometry" in models
    example = endpoint["requestBody"]["content"]["application/json"]["examples"]["target_driven"]["value"]
    response = await client.post(PREVIEW_URL, json=example)
    assert response.status_code == 200
    assert response.json()["metrics"]["footprint_area_m2"] == 646
    assert response.json()["metrics"]["floor_count"] == 4
    assert response.json()["metrics"]["gfa_m2"] == 2584
