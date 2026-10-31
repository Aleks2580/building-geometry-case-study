from copy import deepcopy
from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock, call
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from psycopg import AsyncConnection

import app.geometry.footprints as footprints
from app.application.options import ALGORITHM_VERSION, SCHEMA_VERSION
from app.config import Config
from app.persistence.options import OptionRepository, OptionSnapshot
from app.server import create_app
from app.v1.dependencies import get_option_repository
from app.v1.massing import compute_preview
from app.v1.schemas.massing import MassingPreviewRequest
from app.v1.schemas.options import OptionResponse

OPTIONS_URL = "/api/v1/options"
COMPARE_URL = f"{OPTIONS_URL}/compare"


@pytest.fixture
def payload():
    return {
        "site": {"type": "Polygon", "coordinates": [[[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]]]},
        "hard_constraints": {"setback_m": 3, "floor_to_floor_m": 3.5, "max_height_m": 24, "max_floors": 6},
        "preferences": {"preferred_floor_count": 4},
        "targets": {"gfa_target_m2": 2000},
    }


def _snapshot(payload, option_id):
    preview = compute_preview(MassingPreviewRequest.model_validate(payload)).model_dump(mode="json")
    return OptionSnapshot(
        id=option_id,
        parent_id=None,
        name=None,
        schema_version=SCHEMA_VERSION,
        algorithm_version=ALGORITHM_VERSION,
        site_geometry=preview["site"],
        hard_constraints=preview["hard_constraints"],
        preferences=preview["preferences"],
        targets=preview["targets"],
        result=preview,
        feasibility_status=preview["feasibility"]["status"],
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


@pytest.fixture
async def isolated_client():
    repository = Mock(spec=OptionRepository)
    app = create_app(Config(debug=False))
    app.dependency_overrides[get_option_repository] = lambda: repository
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, repository


@pytest.fixture
async def client(migrated_database):
    app = create_app(Config(database_url=migrated_database, debug=False))
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client


@pytest.mark.parametrize(
    "body",
    [
        {},
        [],
        None,
        {"option_ids": None},
        {"option_ids": []},
        {"option_ids": [str(uuid4())]},
        {"option_ids": [str(uuid4()), str(uuid4()), str(uuid4())]},
        {"option_ids": "not-an-array"},
        {"option_ids": ["not-a-uuid", str(uuid4())]},
        {"option_ids": [str(uuid4()), 42]},
        {"option_ids": [str(uuid4()), None]},
        {"option_ids": [str(uuid4()), str(uuid4())], "site": {}},
    ],
)
async def test_invalid_selection_returns_comparison_envelope_before_reading(isolated_client, body):
    client, repository = isolated_client
    response = await client.post(COMPARE_URL, json=body)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "INVALID_COMPARISON"
    assert error["details"]
    assert all(set(detail) == {"path", "message"} for detail in error["details"])
    repository.get.assert_not_awaited()
    repository.insert.assert_not_awaited()


async def test_duplicate_uuid_spellings_and_malformed_json_are_invalid_comparisons(isolated_client):
    client, repository = isolated_client
    option_id = str(uuid4())
    duplicate = await client.post(COMPARE_URL, json={"option_ids": [option_id, option_id.upper()]})
    malformed = await client.post(COMPARE_URL, content='{"option_ids":', headers={"Content-Type": "application/json"})
    missing = await client.post(COMPARE_URL)
    for response in (duplicate, malformed, missing):
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "INVALID_COMPARISON"
    repository.get.assert_not_awaited()
    repository.insert.assert_not_awaited()


@pytest.mark.parametrize("missing_index", [0, 1])
async def test_missing_option_reports_requested_position_and_never_writes(isolated_client, payload, missing_index):
    client, repository = isolated_client
    ids = [uuid4(), uuid4()]
    repository.get = AsyncMock(side_effect=[None] if missing_index == 0 else [_snapshot(payload, ids[0]), None])

    response = await client.post(COMPARE_URL, json={"option_ids": [str(option_id) for option_id in ids]})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "OPTION_NOT_FOUND"
    assert response.json()["error"]["details"][0]["path"] == f"option_ids[{missing_index}]"
    assert repository.get.await_args_list == [call(option_id) for option_id in ids[: missing_index + 1]]
    repository.insert.assert_not_awaited()


async def test_response_preserves_requested_snapshots_and_signed_numeric_differences(
    isolated_client, payload, monkeypatch
):
    client, repository = isolated_client
    left = _snapshot(payload, UUID(int=2))
    payload["preferences"]["preferred_floor_count"] = 2
    right = _snapshot(payload, UUID(int=1))
    originals = deepcopy((left, right))
    repository.get = AsyncMock(side_effect=lambda option_id: {left.id: left, right.id: right}[option_id])
    monkeypatch.setattr(
        "app.application.massing.generate_massing_with_preferences",
        Mock(side_effect=AssertionError("Comparison must not recompute geometry.")),
    )

    forward = await client.post(COMPARE_URL, json={"option_ids": [str(left.id), str(right.id)]})
    reverse = await client.post(COMPARE_URL, json={"option_ids": [str(right.id), str(left.id)]})

    assert forward.status_code == reverse.status_code == 200
    expected_snapshots = [
        OptionResponse.model_validate(item, from_attributes=True).model_dump(mode="json") for item in originals
    ]
    assert forward.json()["options"] == expected_snapshots
    assert reverse.json()["options"] == expected_snapshots[::-1]
    assert forward.json()["metrics"]["floor_count"] == {"left": 4, "right": 2, "changed": True, "difference": -2}
    assert reverse.json()["metrics"]["floor_count"]["difference"] == 2
    assert forward.json()["inputs"]["preferences"]["preferred_floor_count"]["difference"] == -2
    assert set(forward.json()["metrics"]) == set(left.result["metrics"])
    assert (left, right) == originals
    assert repository.get.await_args_list == [call(left.id), call(right.id), call(right.id), call(left.id)]
    repository.insert.assert_not_awaited()


async def _save(client, payload, *, parent_id=None):
    url = OPTIONS_URL if parent_id is None else f"{OPTIONS_URL}/{parent_id}/branches"
    response = await client.post(url, json=payload)
    assert response.status_code == 201
    return response.json()


@pytest.mark.integration
async def test_preview_save_branch_tree_compare_and_reload_preserve_all_snapshots(
    client, payload, migrated_database, monkeypatch
):
    preview = await client.post("/api/v1/massing/preview", json=payload)
    assert preview.status_code == 200
    root = await _save(client, payload)
    assert root["result"] == preview.json()
    other_payload = deepcopy(payload)
    other_payload["hard_constraints"]["setback_m"] = 1
    other_root = await _save(client, other_payload)
    branch_payload = {"hard_constraints": {"setback_m": 2, "floor_to_floor_m": 3, "max_floors": 3}}
    first = await _save(client, branch_payload, parent_id=root["id"])
    second = await _save(client, {**branch_payload, "preferences": {"preferred_floor_count": 1}}, parent_id=root["id"])
    nested = await _save(client, branch_payload, parent_id=first["id"])
    saved = [root, other_root, first, second, nested]
    listing = (await client.get(OPTIONS_URL)).json()
    tree = await client.get(f"{OPTIONS_URL}/tree", params={"root_id": root["id"]})
    assert tree.status_code == 200
    assert {child["id"] for child in tree.json()["children"]} == {first["id"], second["id"]}
    monkeypatch.setattr(
        "app.application.massing.generate_massing_with_preferences",
        Mock(side_effect=AssertionError("Historical comparison must not recompute geometry.")),
    )
    monkeypatch.setattr(
        OptionRepository, "insert", AsyncMock(side_effect=AssertionError("Comparison must never insert an option."))
    )
    pairs = [(other_root, root), (second, first), (nested, root), (first, nested)]
    comparisons = []
    for left, right in pairs:
        response = await client.post(COMPARE_URL, json={"option_ids": [left["id"], right["id"]]})
        assert response.status_code == 200
        comparison = response.json()
        assert comparison["options"] == [left, right]
        assert (
            comparison["metrics"]["gfa_m2"]["difference"]
            == right["result"]["metrics"]["gfa_m2"] - left["result"]["metrics"]["gfa_m2"]
        )
        comparisons.append(comparison)

    restarted = create_app(Config(database_url=migrated_database, debug=False))
    async with restarted.router.lifespan_context(restarted):
        async with AsyncClient(transport=ASGITransport(app=restarted), base_url="http://restart") as reloaded_client:
            for (left, right), expected in zip(pairs, comparisons, strict=True):
                response = await reloaded_client.post(COMPARE_URL, json={"option_ids": [left["id"], right["id"]]})
                assert response.status_code == 200
                assert response.json() == expected
            assert (await reloaded_client.get(OPTIONS_URL)).json() == listing
            assert (
                await reloaded_client.get(f"{OPTIONS_URL}/tree", params={"root_id": root["id"]})
            ).json() == tree.json()
            for snapshot in saved:
                assert (await reloaded_client.get(f"{OPTIONS_URL}/{snapshot['id']}")).json() == snapshot


@pytest.mark.integration
async def test_diagnostic_snapshots_and_nullable_metrics_compare_in_read_only_transaction(
    client, payload, migrated_database, monkeypatch
):
    feasible = await _save(client, payload)
    diagnostic_snapshots = []
    for status in ("feasible_target_unmet", "infeasible", "generation_failed"):
        diagnostic_payload = deepcopy(payload)
        if status == "feasible_target_unmet":
            diagnostic_payload["targets"]["gfa_target_m2"] = 5000
        elif status == "infeasible":
            diagnostic_payload["hard_constraints"]["setback_m"] = 30
        else:
            diagnostic_payload["hard_constraints"]["max_footprint_m2"] = 100
            monkeypatch.setattr(footprints, "MAX_FOOTPRINT_SEARCH_ITERATIONS", 0)
        saved = await _save(client, diagnostic_payload)
        assert saved["feasibility_status"] == status
        diagnostic_snapshots.append(saved)

    monkeypatch.setattr(
        "app.application.options.preview_massing", Mock(side_effect=AssertionError("Comparison is read-only."))
    )
    app = create_app(Config(debug=False))
    async with await AsyncConnection.connect(migrated_database) as connection:
        async with connection.transaction():
            await connection.execute("SET TRANSACTION READ ONLY")
            app.dependency_overrides[get_option_repository] = lambda: OptionRepository(connection)
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://readonly") as readonly_client:
                for diagnostic in diagnostic_snapshots:
                    response = await readonly_client.post(
                        COMPARE_URL, json={"option_ids": [feasible["id"], diagnostic["id"]]}
                    )
                    assert response.status_code == 200
                    comparison = response.json()
                    assert comparison["options"] == [feasible, diagnostic]
                    assert comparison["feasibility"]["status"]["changed"] is True
                    assert comparison["diagnostics"]["right"] == diagnostic["result"]["feasibility"]["diagnostics"]
                    assert comparison["diagnostics"]["changed"] is True
                    if diagnostic["feasibility_status"] in {"infeasible", "generation_failed"}:
                        assert comparison["metrics"]["gfa_m2"] == {
                            "left": 2584,
                            "right": None,
                            "changed": True,
                            "difference": None,
                        }
                response = await readonly_client.post(
                    COMPARE_URL, json={"option_ids": [item["id"] for item in diagnostic_snapshots[1:]]}
                )
                assert response.status_code == 200
                assert response.json()["metrics"]["gfa_m2"] == {
                    "left": None,
                    "right": None,
                    "changed": False,
                    "difference": None,
                }


def test_comparison_openapi_requires_two_uuids_and_reuses_snapshot_and_error_contracts():
    schema = create_app(Config()).openapi()
    paths = schema["paths"]
    assert list(paths).index(COMPARE_URL) < list(paths).index(f"{OPTIONS_URL}/{{option_id}}")
    operation = paths[COMPARE_URL]["post"]
    components = schema["components"]["schemas"]
    request_schema = operation["requestBody"]["content"]["application/json"]["schema"]
    request = components[request_schema["$ref"].rsplit("/", 1)[1]]
    assert "option_ids" in request["required"]
    selection = request["properties"]["option_ids"]
    assert selection["minItems"] == selection["maxItems"] == 2
    uuid_items = selection.get("prefixItems", [selection.get("items")])
    assert all(item["type"] == "string" and item["format"] == "uuid" for item in uuid_items)
    for status in ("404", "422"):
        assert operation["responses"][status]["content"]["application/json"]["schema"]["$ref"].endswith("ErrorResponse")
    response_schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
    response = components[response_schema["$ref"].rsplit("/", 1)[1]]
    options = response["properties"]["options"]
    assert options["minItems"] == options["maxItems"] == 2
    assert all(item["$ref"].endswith("OptionResponse") for item in options["prefixItems"])
