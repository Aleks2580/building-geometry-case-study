from math import nextafter
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from shapely.geometry import Polygon, box

import app.geometry.footprints as footprints
from app.application.options import ALGORITHM_VERSION
from app.config import Config
from app.geometry import serialize_site_geometry
from app.server import create_app
from app.v1.schemas.options import BranchOptionRequest

OPTIONS_URL = "/api/v1/options"


@pytest.fixture
def root_payload():
    return {
        "site": {"type": "Polygon", "coordinates": [[[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]]]},
        "hard_constraints": {"setback_m": 3, "floor_to_floor_m": 3.5, "max_height_m": 24, "max_floors": 6},
        "preferences": {"preferred_floor_count": 4},
        "targets": {"gfa_target_m2": 2000},
        "name": "Parent study",
    }


@pytest.fixture
def branch_payload():
    return {
        "hard_constraints": {
            "setback_m": 2,
            "floor_to_floor_m": 3,
            "max_height_m": 12,
            "max_floors": 3,
            "site_coverage_ratio": 0.5,
            "max_footprint_m2": 400,
        },
        "preferences": {"preferred_floor_count": 2, "preferred_footprint_area_m2": 350},
        "targets": {"gfa_target_m2": 500},
    }


@pytest.fixture
async def client(migrated_database):
    app = create_app(Config(database_url=migrated_database, debug=False))
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test"
        ) as client:
            yield client


async def _save_parent(client, payload):
    response = await client.post(OPTIONS_URL, json=payload)
    assert response.status_code == 201
    return response.json()


@pytest.mark.integration
async def test_branch_recomputes_complete_configuration_and_reloads_after_restart(
    client, root_payload, branch_payload, migrated_database
):
    parent = await _save_parent(client, root_payload)
    preview = await client.post("/api/v1/massing/preview", json={"site": parent["site_geometry"], **branch_payload})
    assert preview.status_code == 200
    branch_payload["name"] = "  Reduced footprint  "
    response = await client.post(f"{OPTIONS_URL}/{parent['id']}/branches", json=branch_payload)
    assert response.status_code == 201
    child = response.json()
    assert response.headers["Location"] == f"{OPTIONS_URL}/{child['id']}"
    assert child["id"] != parent["id"]
    assert child["parent_id"] == parent["id"]
    assert child["name"] == "Reduced footprint"
    assert child["site_geometry"] == parent["site_geometry"]
    assert child["result"] == preview.json()
    for field in ("hard_constraints", "preferences", "targets"):
        assert child[field] == child["result"][field]
        assert child[field] == branch_payload[field]
    assert child["schema_version"] == parent["schema_version"]
    assert child["algorithm_version"] == parent["algorithm_version"]
    assert child["created_at"].endswith(("Z", "+00:00"))
    assert (await client.get(f"{OPTIONS_URL}/{parent['id']}")).json() == parent

    restarted = create_app(Config(database_url=migrated_database))
    async with restarted.router.lifespan_context(restarted):
        async with AsyncClient(transport=ASGITransport(app=restarted), base_url="http://restart") as second:
            assert (await second.get(response.headers["Location"])).json() == child
            assert (await second.get(f"{OPTIONS_URL}/{parent['id']}")).json() == parent


@pytest.mark.integration
@pytest.mark.parametrize("legacy_policy", ["massing-v1", "massing-v2"])
async def test_legacy_policy_parent_branches_with_current_policy_without_changing_parent(
    client, root_payload, branch_payload, monkeypatch, legacy_policy
):
    legacy_version = f"{legacy_policy};{ALGORITHM_VERSION.split(';', 1)[1]}"
    with monkeypatch.context() as patch:
        patch.setattr("app.application.options.ALGORITHM_VERSION", legacy_version)
        parent = await _save_parent(client, root_payload)

    response = await client.post(f"{OPTIONS_URL}/{parent['id']}/branches", json=branch_payload)

    assert response.status_code == 201
    child = response.json()
    assert child["parent_id"] == parent["id"]
    assert child["algorithm_version"] == ALGORITHM_VERSION != legacy_version
    assert parent["algorithm_version"] == legacy_version
    assert child["schema_version"] == parent["schema_version"] == 1
    assert (await client.get(f"{OPTIONS_URL}/{parent['id']}")).json() == parent
    assert (await client.get(f"{OPTIONS_URL}/{child['id']}")).json() == child


@pytest.mark.integration
async def test_siblings_and_nested_branches_replace_defaults_without_changing_ancestors(client, root_payload):
    parent = await _save_parent(client, root_payload)
    payload = {"hard_constraints": {"setback_m": 0, "floor_to_floor_m": 3, "max_floors": 3}}
    first_response = await client.post(f"{OPTIONS_URL}/{parent['id']}/branches", json=payload)
    assert first_response.status_code == 201
    first = first_response.json()
    payload["name"] = None
    second_response = await client.post(f"{OPTIONS_URL}/{parent['id']}/branches", json=payload)
    assert second_response.status_code == 201
    second = second_response.json()
    payload["preferences"] = {"preferred_floor_count": 1}
    nested_response = await client.post(f"{OPTIONS_URL}/{first['id']}/branches", json=payload)
    assert nested_response.status_code == 201
    nested = nested_response.json()
    assert len({parent["id"], first["id"], second["id"], nested["id"]}) == 4
    assert first["parent_id"] == second["parent_id"] == parent["id"]
    assert nested["parent_id"] == first["id"]
    for child in (first, second):
        assert child["name"] is None
        assert child["preferences"] == {"preferred_floor_count": None, "preferred_footprint_area_m2": None}
        assert child["targets"] == {"gfa_target_m2": None}
        assert child["hard_constraints"]["max_height_m"] is None
        assert child["result"]["metrics"]["floor_count"] == 3
    assert nested["result"]["metrics"]["floor_count"] == 1
    for saved in (parent, first, second, nested):
        assert saved["site_geometry"] == parent["site_geometry"]
        assert (await client.get(f"{OPTIONS_URL}/{saved['id']}")).json() == saved
    assert len((await client.get(OPTIONS_URL)).json()) == 4


@pytest.mark.integration
@pytest.mark.parametrize("status", ["feasible", "feasible_target_unmet", "infeasible", "generation_failed"])
async def test_branch_preserves_every_feasibility_status_and_diagnostic_result(
    client, root_payload, monkeypatch, status
):
    parent = await _save_parent(client, root_payload)
    payload = {key: value for key, value in root_payload.items() if key not in {"site", "name"}}
    if status == "feasible_target_unmet":
        payload["targets"]["gfa_target_m2"] = 5000
    elif status == "infeasible":
        payload["hard_constraints"]["setback_m"] = 30
    elif status == "generation_failed":
        payload["hard_constraints"]["max_footprint_m2"] = 100
        monkeypatch.setattr(footprints, "MAX_FOOTPRINT_SEARCH_ITERATIONS", 0)
    response = await client.post(f"{OPTIONS_URL}/{parent['id']}/branches", json=payload)
    assert response.status_code == 201
    child = response.json()
    assert child["feasibility_status"] == child["result"]["feasibility"]["status"] == status
    if status in {"infeasible", "generation_failed"}:
        assert child["result"]["footprint_geometry"] is None
        assert child["result"]["metrics"]["gfa_m2"] is None
        assert child["result"]["feasibility"]["diagnostics"]
    assert (await client.get(response.headers["Location"])).json() == child
    assert (await client.get(f"{OPTIONS_URL}/{parent['id']}")).json() == parent
    summary = next(item for item in (await client.get(OPTIONS_URL)).json() if item["id"] == child["id"])
    assert summary["parent_id"] == parent["id"]
    assert summary["feasibility_status"] == status


@pytest.mark.integration
async def test_diagnostic_parent_can_have_a_feasible_child(client, root_payload):
    root_payload["hard_constraints"]["setback_m"] = 30
    parent = await _save_parent(client, root_payload)
    assert parent["feasibility_status"] == "infeasible"
    response = await client.post(
        f"{OPTIONS_URL}/{parent['id']}/branches",
        json={"hard_constraints": {"setback_m": 0, "floor_to_floor_m": 3, "max_floors": 2}},
    )
    assert response.status_code == 201
    assert response.json()["feasibility_status"] == "feasible"
    assert (await client.get(f"{OPTIONS_URL}/{parent['id']}")).json() == parent


@pytest.mark.integration
@pytest.mark.parametrize("geometry", ["holes", "split"])
async def test_branch_inherits_precise_site_and_preserves_geometry_semantics(client, root_payload, geometry):
    if geometry == "holes":
        site = Polygon(box(0, 0, 40.12345678912345, 25).exterior.coords, [box(8, 8, 12, 12).exterior.coords])
        setback = 0
    else:
        site = box(0, 0, 20, 20).union(box(30, 0, 50, 20)).union(box(20, 9, 30, 11))
        setback = 2
    root_payload["site"] = serialize_site_geometry(site)
    root_payload["hard_constraints"]["setback_m"] = 0
    parent = await _save_parent(client, root_payload)
    payload = {"hard_constraints": {"setback_m": setback, "floor_to_floor_m": 3.5, "max_floors": 6}}
    preview = await client.post("/api/v1/massing/preview", json={"site": parent["site_geometry"], **payload})
    response = await client.post(f"{OPTIONS_URL}/{parent['id']}/branches", json=payload)
    assert response.status_code == 201
    child = response.json()
    assert child["site_geometry"] == parent["site_geometry"]
    assert child["result"] == preview.json()
    if geometry == "holes":
        assert len(child["result"]["footprint_geometry"]["coordinates"]) == 2
    else:
        assert child["result"]["buildable_geometry"]["type"] == "MultiPolygon"
        assert child["result"]["setback"]["component_count"] == 2
    assert (await client.get(response.headers["Location"])).json() == child


@pytest.mark.integration
async def test_branch_preserves_arbitrary_integer_floors_and_subnormal_lengths(client, root_payload):
    root_payload["site"] = serialize_site_geometry(box(0, 0, 1e-160, 1e-160))
    root_payload["hard_constraints"] = {"setback_m": 0, "floor_to_floor_m": 5e-324, "max_floors": 1}
    root_payload["preferences"] = {}
    root_payload["targets"] = {}
    parent = await _save_parent(client, root_payload)
    count = 2**1074
    response = await client.post(
        f"{OPTIONS_URL}/{parent['id']}/branches",
        json={
            "hard_constraints": {"setback_m": 0, "floor_to_floor_m": 5e-324, "max_floors": count},
            "preferences": {"preferred_floor_count": count},
        },
    )
    assert response.status_code == 201
    child = response.json()
    assert child["hard_constraints"]["floor_to_floor_m"] == 5e-324
    assert child["result"]["metrics"]["floor_count"] == count
    assert child["result"]["metrics"]["height_m"] == 1
    assert (await client.get(response.headers["Location"])).json() == child


@pytest.mark.integration
async def test_branch_uses_exact_height_cap_policy(client, root_payload):
    parent = await _save_parent(client, root_payload)
    payload = {
        "hard_constraints": {"setback_m": 0, "floor_to_floor_m": 3.6, "max_height_m": 36},
        "preferences": {"preferred_floor_count": 10},
    }
    response = await client.post(f"{OPTIONS_URL}/{parent['id']}/branches", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "PREFERENCE_EXCEEDS_HARD_LIMIT"
    payload["hard_constraints"]["max_height_m"] = nextafter(36, float("inf"))
    response = await client.post(f"{OPTIONS_URL}/{parent['id']}/branches", json=payload)
    assert response.status_code == 201
    assert response.json()["result"]["metrics"]["floor_count"] == 10


@pytest.mark.integration
@pytest.mark.parametrize(
    "field,value,code",
    [
        ("site", {"type": "Polygon", "coordinates": []}, "INVALID_SITE_GEOMETRY"),
        ("site_geometry", {}, "INVALID_REQUEST"),
        ("parent_id", str(uuid4()), "INVALID_REQUEST"),
        ("option_id", str(uuid4()), "INVALID_REQUEST"),
        ("result", {"metrics": {"gfa_m2": 1}}, "INVALID_REQUEST"),
        ("metrics", {"gfa_m2": 1}, "INVALID_REQUEST"),
        ("name", " ", "INVALID_REQUEST"),
        ("name", "a" * 201, "INVALID_REQUEST"),
        ("name", "Invalid\x00name", "INVALID_REQUEST"),
        ("name", 123, "INVALID_REQUEST"),
        ("preferences", None, "INVALID_PREFERENCE"),
        ("preferences", {"preferred_floor_count": 7}, "PREFERENCE_EXCEEDS_HARD_LIMIT"),
        ("targets", {"gfa_target_m2": -1}, "INVALID_TARGET"),
        ("hard_constraints", {"setback_m": 0, "floor_to_floor_m": 3}, "INVALID_CONSTRAINTS"),
        (
            "hard_constraints",
            {"setback_m": 0, "floor_to_floor_m": 1e308, "max_floors": 2},
            "NUMERICAL_RANGE_ERROR",
        ),
    ],
)
async def test_invalid_branch_inserts_nothing_and_preserves_parent(client, root_payload, field, value, code):
    parent = await _save_parent(client, root_payload)
    payload = {"hard_constraints": root_payload["hard_constraints"], field: value}
    response = await client.post(f"{OPTIONS_URL}/{parent['id']}/branches", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
    assert "Location" not in response.headers
    assert (await client.get(f"{OPTIONS_URL}/{parent['id']}")).json() == parent
    assert len((await client.get(OPTIONS_URL)).json()) == 1


@pytest.mark.integration
async def test_missing_parents_and_malformed_identifiers_use_existing_error_envelope(client, branch_payload):
    response = await client.post(f"{OPTIONS_URL}/{uuid4()}/branches", json=branch_payload)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "PARENT_OPTION_NOT_FOUND"
    assert response.json()["error"]["details"][0]["path"] == "option_id"
    response = await client.post(f"{OPTIONS_URL}/not-a-uuid/branches", json=branch_payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
    response = await client.post(f"{OPTIONS_URL}/{uuid4()}/branches", json={})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_CONSTRAINTS"
    assert (await client.get(OPTIONS_URL)).json() == []


@pytest.mark.integration
async def test_failed_branch_rolls_back_without_losing_parent_or_prior_sibling(
    client, root_payload, branch_payload, monkeypatch
):
    parent = await _save_parent(client, root_payload)
    url = f"{OPTIONS_URL}/{parent['id']}/branches"
    response = await client.post(url, json=branch_payload)
    assert response.status_code == 201
    sibling = response.json()
    with monkeypatch.context() as patch:
        patch.setattr("app.application.options.SCHEMA_VERSION", 0)
        failed = await client.post(url, json=branch_payload)
    assert failed.status_code == 500
    assert "Location" not in failed.headers
    assert len((await client.get(OPTIONS_URL)).json()) == 2
    for saved in (parent, sibling):
        assert (await client.get(f"{OPTIONS_URL}/{saved['id']}")).json() == saved
    assert (await client.post(url, json=branch_payload)).status_code == 201


def test_branch_openapi_reuses_contracts_and_documents_location_and_errors():
    schema = create_app(Config()).openapi()
    operation = schema["paths"][f"{OPTIONS_URL}/{{option_id}}/branches"]["post"]
    assert operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("BranchOptionRequest")
    assert operation["responses"]["201"]["content"]["application/json"]["schema"]["$ref"].endswith("OptionResponse")
    assert operation["responses"]["201"]["headers"]["Location"]["schema"]["type"] == "string"
    for status in ("404", "422"):
        assert operation["responses"][status]["content"]["application/json"]["schema"]["$ref"].endswith("ErrorResponse")
    request_schema = BranchOptionRequest.model_json_schema()
    assert request_schema["required"] == ["hard_constraints"]
    assert request_schema["additionalProperties"] is False
    assert set(request_schema["properties"]) == {"hard_constraints", "preferences", "targets", "name"}
    assert request_schema["properties"]["hard_constraints"]["$ref"].endswith("HardConstraints")
    assert request_schema["properties"]["preferences"]["$ref"].endswith("DesignPreferences")
    assert request_schema["properties"]["targets"]["$ref"].endswith("DesignTargets")
