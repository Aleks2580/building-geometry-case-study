from copy import deepcopy
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from psycopg import AsyncConnection
from psycopg.errors import CheckViolation
from shapely.geometry import Polygon, box

import app.geometry.footprints as footprints
from app.application.options import ALGORITHM_VERSION, SCHEMA_VERSION
from app.config import Config
from app.geometry import serialize_site_geometry
from app.server import create_app
from app.v1.schemas.options import RootOptionRequest

pytestmark = pytest.mark.integration
OPTIONS_URL = "/api/v1/options"


@pytest.fixture
def payload():
    return {
        "site": {"type": "Polygon", "coordinates": [[[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]]]},
        "hard_constraints": {"setback_m": 3, "floor_to_floor_m": 3.5, "max_height_m": 24, "max_floors": 6},
        "preferences": {"preferred_floor_count": 4},
        "targets": {"gfa_target_m2": 2000},
    }


@pytest.fixture
async def client(migrated_database):
    app = create_app(Config(database_url=migrated_database, debug=False))
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test"
        ) as client:
            yield client


async def test_save_retrieve_and_list_complete_server_computed_snapshot(client, payload, migrated_database):
    preview = (await client.post("/api/v1/massing/preview", json=payload)).json()
    payload["name"] = "  Courtyard study  "
    response = await client.post(OPTIONS_URL, json=payload)
    assert response.status_code == 201
    saved = response.json()
    assert response.headers["Location"] == f"{OPTIONS_URL}/{saved['id']}"
    assert saved["parent_id"] is None
    assert saved["name"] == "Courtyard study"
    assert saved["schema_version"] == SCHEMA_VERSION
    assert saved["algorithm_version"] == ALGORITHM_VERSION
    assert saved["created_at"].endswith(("Z", "+00:00"))
    assert saved["result"] == preview
    assert saved["site_geometry"] == preview["site"]
    for field in ("hard_constraints", "preferences", "targets"):
        assert saved[field] == preview[field]

    loaded = await client.get(response.headers["Location"])
    assert loaded.status_code == 200
    assert loaded.json() == saved
    summaries = await client.get(OPTIONS_URL)
    assert summaries.status_code == 200
    assert len(summaries.json()) == 1
    summary = summaries.json()[0]
    assert summary["id"] == saved["id"]
    assert summary["metrics"] == preview["metrics"]
    assert "result" not in summary
    assert "site_geometry" not in summary

    async with await AsyncConnection.connect(migrated_database) as connection:
        cursor = await connection.execute("SELECT count(*), min(feasibility_status) FROM options")
        assert await cursor.fetchone() == (1, "feasible")


@pytest.mark.parametrize("status", ["feasible", "feasible_target_unmet", "infeasible", "generation_failed"])
async def test_all_statuses_can_be_saved_as_complete_diagnostic_snapshots(client, payload, monkeypatch, status):
    if status == "feasible_target_unmet":
        payload["targets"]["gfa_target_m2"] = 5000
    elif status == "infeasible":
        payload["hard_constraints"]["setback_m"] = 30
    elif status == "generation_failed":
        payload["hard_constraints"]["max_footprint_m2"] = 100
        monkeypatch.setattr(footprints, "MAX_FOOTPRINT_SEARCH_ITERATIONS", 0)

    response = await client.post(OPTIONS_URL, json=payload)
    assert response.status_code == 201
    saved = response.json()
    assert saved["feasibility_status"] == saved["result"]["feasibility"]["status"] == status
    if status in {"infeasible", "generation_failed"}:
        assert saved["result"]["footprint_geometry"] is None
        assert saved["result"]["metrics"]["gfa_m2"] is None
        assert saved["result"]["feasibility"]["diagnostics"]
    assert (await client.get(f"{OPTIONS_URL}/{saved['id']}")).json() == saved
    assert (await client.get(OPTIONS_URL)).json()[0]["feasibility_status"] == status


@pytest.mark.parametrize("geometry", ["holes", "split"])
async def test_geometry_and_preferences_survive_http_snapshot_round_trip(client, payload, geometry):
    if geometry == "holes":
        site = Polygon(box(0, 0, 40.12345678912345, 25).exterior.coords, [box(8, 8, 12, 12).exterior.coords])
        payload["hard_constraints"]["setback_m"] = 0
    else:
        site = box(0, 0, 20, 20).union(box(30, 0, 50, 20)).union(box(20, 9, 30, 11))
        payload["hard_constraints"]["setback_m"] = 2
    payload["site"] = serialize_site_geometry(site)
    payload["preferences"]["preferred_footprint_area_m2"] = 500
    response = await client.post(OPTIONS_URL, json=payload)
    assert response.status_code == 201
    saved = response.json()
    assert saved["preferences"]["preferred_footprint_area_m2"] == 500
    assert saved["result"]["preference_results"]["footprint_area"] is not None
    if geometry == "holes":
        assert len(saved["site_geometry"]["coordinates"]) == 2
    else:
        assert saved["result"]["buildable_geometry"]["type"] == "MultiPolygon"
    assert (await client.get(f"{OPTIONS_URL}/{saved['id']}")).json() == saved


async def test_repeated_saves_insert_new_roots_without_changing_existing_options(client, payload):
    first = (await client.post(OPTIONS_URL, json=payload)).json()
    original = deepcopy(first)
    payload["preferences"]["preferred_floor_count"] = 2
    second = (await client.post(OPTIONS_URL, json=payload)).json()
    assert first["id"] != second["id"]
    assert first["parent_id"] is second["parent_id"] is None
    assert (await client.get(f"{OPTIONS_URL}/{first['id']}")).json() == original
    assert second["result"]["metrics"]["floor_count"] == 2
    assert len((await client.get(OPTIONS_URL)).json()) == 2


async def test_reads_never_recompute_historical_results(client, payload, monkeypatch):
    saved = (await client.post(OPTIONS_URL, json=payload)).json()

    def fail(*args, **kwargs):
        raise AssertionError("Historical snapshots must not be recomputed.")

    monkeypatch.setattr("app.application.massing.generate_massing_with_preferences", fail)
    assert (await client.get(f"{OPTIONS_URL}/{saved['id']}")).json() == saved
    assert (await client.get(OPTIONS_URL)).json()[0]["metrics"] == saved["result"]["metrics"]


async def test_missing_and_malformed_identifiers_use_existing_error_envelope(client):
    response = await client.get(f"{OPTIONS_URL}/{uuid4()}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "OPTION_NOT_FOUND"
    assert response.json()["error"]["details"][0]["path"] == "option_id"
    response = await client.get(f"{OPTIONS_URL}/not-a-uuid")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("result", {"metrics": {"gfa_m2": 1}}, "INVALID_REQUEST"),
        ("metrics", {"gfa_m2": 1}, "INVALID_REQUEST"),
        ("parent_id", str(uuid4()), "INVALID_REQUEST"),
        ("name", " ", "INVALID_REQUEST"),
        ("name", "a" * 201, "INVALID_REQUEST"),
        ("name", "Invalid\x00name", "INVALID_REQUEST"),
        ("name", 123, "INVALID_REQUEST"),
        ("targets", {"gfa_target_m2": -1}, "INVALID_TARGET"),
        ("preferences", {"preferred_floor_count": 7}, "PREFERENCE_EXCEEDS_HARD_LIMIT"),
        ("site", {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [2, 0], [0, 0]]]}, "INVALID_SITE_GEOMETRY"),
    ],
)
async def test_invalid_save_never_inserts_any_snapshot(client, payload, field, value, code):
    payload[field] = value
    response = await client.post(OPTIONS_URL, json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
    assert (await client.get(OPTIONS_URL)).json() == []


async def test_database_constraint_failure_rolls_back_and_does_not_return_a_saved_snapshot(
    client, payload, monkeypatch
):
    monkeypatch.setattr("app.application.options.SCHEMA_VERSION", 0)
    response = await client.post(OPTIONS_URL, json=payload)
    assert response.status_code == 500
    assert (await client.get(OPTIONS_URL)).json() == []


async def test_failed_insert_does_not_remove_previously_saved_option(client, payload, monkeypatch):
    saved = (await client.post(OPTIONS_URL, json=payload)).json()
    monkeypatch.setattr("app.application.options.SCHEMA_VERSION", 0)
    assert (await client.post(OPTIONS_URL, json=payload)).status_code == 500
    assert (await client.get(f"{OPTIONS_URL}/{saved['id']}")).json() == saved
    assert len((await client.get(OPTIONS_URL)).json()) == 1


async def test_list_pagination_is_bounded_and_excludes_complete_snapshots(client, payload):
    assert (await client.get(OPTIONS_URL)).json() == []
    saved = [(await client.post(OPTIONS_URL, json=payload)).json() for _ in range(3)]
    expected = sorted(saved, key=lambda item: (item["created_at"], item["id"]), reverse=True)
    first = await client.get(OPTIONS_URL, params={"limit": 2})
    last = await client.get(OPTIONS_URL, params={"limit": 2, "offset": 2})
    assert [item["id"] for item in first.json() + last.json()] == [item["id"] for item in expected]
    for params in ({"limit": 0}, {"limit": 201}, {"offset": -1}):
        response = await client.get(OPTIONS_URL, params=params)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "INVALID_REQUEST"


async def test_pool_and_application_restart_reloads_stored_snapshots(client, payload, migrated_database):
    saved = (await client.post(OPTIONS_URL, json=payload)).json()
    restarted = create_app(Config(database_url=migrated_database))
    async with restarted.router.lifespan_context(restarted):
        async with AsyncClient(transport=ASGITransport(app=restarted), base_url="http://restart") as second:
            assert (await second.get(f"{OPTIONS_URL}/{saved['id']}")).json() == saved


async def test_database_guards_status_consistency(client, payload, migrated_database):
    saved = (await client.post(OPTIONS_URL, json=payload)).json()
    async with await AsyncConnection.connect(migrated_database) as connection:
        with pytest.raises(CheckViolation):
            async with connection.transaction():
                await connection.execute(
                    "UPDATE options SET feasibility_status = %s WHERE id = %s", ("infeasible", saved["id"])
                )
    assert (await client.get(f"{OPTIONS_URL}/{saved['id']}")).json() == saved


def test_option_openapi_reuses_preview_models_and_error_contracts():
    schema = create_app(Config()).openapi()
    paths = schema["paths"]
    assert paths[OPTIONS_URL]["post"]["responses"]["201"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "OptionResponse"
    )
    assert paths[f"{OPTIONS_URL}/{{option_id}}"]["get"]["responses"]["404"]["content"]["application/json"]["schema"][
        "$ref"
    ].endswith("ErrorResponse")
    assert schema["components"]["schemas"]["OptionResponse"]["properties"]["result"]["$ref"].endswith(
        "MassingPreviewResponse"
    )
    assert "name" in RootOptionRequest.model_json_schema()["properties"]
    assert f"{OPTIONS_URL}/{{option_id}}/branches" in paths
    assert f"{OPTIONS_URL}/tree" in paths
    assert f"{OPTIONS_URL}/compare" in paths
