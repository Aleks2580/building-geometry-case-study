from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

import app.geometry.footprints as footprints
from app.config import Config
from app.persistence.options import OptionRepository
from app.server import create_app
from app.v1.dependencies import get_option_repository

OPTIONS_URL = "/api/v1/options"
TREE_URL = f"{OPTIONS_URL}/tree"


@pytest.fixture
def payload():
    return {
        "site": {"type": "Polygon", "coordinates": [[[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]]]},
        "hard_constraints": {"setback_m": 3, "floor_to_floor_m": 3.5, "max_height_m": 24, "max_floors": 6},
        "preferences": {"preferred_floor_count": 4},
        "targets": {"gfa_target_m2": 2000},
        "name": "Root study",
    }


@pytest.fixture
async def client(migrated_database):
    app = create_app(Config(database_url=migrated_database, debug=False))
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client


@pytest.fixture
async def isolated_client():
    repository = Mock(spec=OptionRepository)
    repository.get_descendant_summaries = AsyncMock(return_value=[])
    app = create_app(Config(debug=False))
    app.dependency_overrides[get_option_repository] = lambda: repository
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, repository


@pytest.mark.parametrize("params", [{}, {"root_id": "not-a-uuid"}, {"root_id": ""}])
async def test_tree_requires_a_valid_root_uuid_with_structured_query_errors(isolated_client, params):
    client, repository = isolated_client
    response = await client.get(TREE_URL, params=params)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "INVALID_REQUEST"
    assert error["details"][0]["path"] == "query.root_id"
    repository.get_descendant_summaries.assert_not_awaited()
    repository.get.assert_not_awaited()
    repository.insert.assert_not_awaited()


async def test_tree_static_route_returns_option_not_found_for_unknown_root(isolated_client):
    client, repository = isolated_client
    root_id = uuid4()
    response = await client.get(TREE_URL, params={"root_id": str(root_id)})
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "OPTION_NOT_FOUND"
    assert error["details"][0]["path"] == "root_id"
    repository.get_descendant_summaries.assert_awaited_once_with(root_id)
    repository.get.assert_not_awaited()
    repository.insert.assert_not_awaited()


async def _save(client, payload, *, parent_id=None):
    url = OPTIONS_URL if parent_id is None else f"{OPTIONS_URL}/{parent_id}/branches"
    response = await client.post(url, json=payload)
    assert response.status_code == 201
    saved = response.json()
    assert response.headers["Location"] == f"{OPTIONS_URL}/{saved['id']}"
    return saved


@pytest.mark.integration
@pytest.mark.parametrize("status", ["feasible", "feasible_target_unmet", "infeasible", "generation_failed"])
async def test_root_only_tree_reuses_lightweight_summary_and_all_feasibility_statuses(
    client, payload, monkeypatch, status
):
    if status == "feasible_target_unmet":
        payload["targets"]["gfa_target_m2"] = 5000
    elif status == "infeasible":
        payload["hard_constraints"]["setback_m"] = 30
    elif status == "generation_failed":
        payload["hard_constraints"]["max_footprint_m2"] = 100
        monkeypatch.setattr(footprints, "MAX_FOOTPRINT_SEARCH_ITERATIONS", 0)
    saved = await _save(client, payload)
    summaries = (await client.get(OPTIONS_URL)).json()

    response = await client.get(TREE_URL, params={"root_id": saved["id"]})

    assert response.status_code == 200
    tree = response.json()
    assert tree == {**summaries[0], "children": []}
    assert tree["feasibility_status"] == status
    assert tree["metrics"] == saved["result"]["metrics"]
    assert "result" not in tree
    assert "site_geometry" not in tree
    if status in {"infeasible", "generation_failed"}:
        assert tree["metrics"]["gfa_m2"] is None
    assert (await client.get(f"{OPTIONS_URL}/{saved['id']}")).json() == saved
    assert (await client.get(OPTIONS_URL)).json() == summaries


@pytest.mark.integration
async def test_tree_preserves_siblings_subtrees_and_independent_roots_after_reload(
    client, payload, migrated_database, monkeypatch
):
    root = await _save(client, payload)
    branch_payload = {"hard_constraints": {"setback_m": 2, "floor_to_floor_m": 3, "max_floors": 3}}
    first = await _save(client, {**branch_payload, "name": "First branch"}, parent_id=root["id"])
    second = await _save(client, {**branch_payload, "name": "Second branch"}, parent_id=root["id"])
    nested = await _save(client, {**branch_payload, "name": "Nested branch"}, parent_id=first["id"])
    independent = await _save(client, {**payload, "name": "Independent root"})
    independent_child = await _save(client, branch_payload, parent_id=independent["id"])
    saved = [root, first, second, nested, independent, independent_child]
    listing = (await client.get(OPTIONS_URL)).json()
    summaries = {summary["id"]: summary for summary in listing}
    first_tree = {**summaries[first["id"]], "children": [{**summaries[nested["id"]], "children": []}]}
    children = [first_tree, {**summaries[second["id"]], "children": []}]
    children.sort(key=lambda node: (node["created_at"], node["id"]))
    expected = {**summaries[root["id"]], "children": children}
    monkeypatch.setattr(
        "app.application.options.preview_massing",
        Mock(side_effect=AssertionError("Tree retrieval must not recompute saved options.")),
    )

    response = await client.get(TREE_URL, params={"root_id": root["id"]})
    assert response.status_code == 200
    assert response.json() == expected
    subtree = await client.get(TREE_URL, params={"root_id": first["id"]})
    assert subtree.status_code == 200
    assert subtree.json() == first_tree
    assert subtree.json()["parent_id"] == root["id"]
    independent_tree = await client.get(TREE_URL, params={"root_id": independent["id"]})
    assert independent_tree.status_code == 200
    assert independent_tree.json() == {
        **summaries[independent["id"]],
        "children": [{**summaries[independent_child["id"]], "children": []}],
    }

    restarted = create_app(Config(database_url=migrated_database))
    async with restarted.router.lifespan_context(restarted):
        async with AsyncClient(transport=ASGITransport(app=restarted), base_url="http://restart") as second_client:
            reloaded = await second_client.get(TREE_URL, params={"root_id": root["id"]})
            assert reloaded.status_code == 200
            assert reloaded.json() == expected
            assert (await second_client.get(OPTIONS_URL)).json() == listing
            for snapshot in saved:
                assert (await second_client.get(f"{OPTIONS_URL}/{snapshot['id']}")).json() == snapshot


def test_tree_openapi_requires_uuid_and_reuses_recursive_typed_summary_contract():
    schema = create_app(Config()).openapi()
    paths = schema["paths"]
    assert list(paths).index(TREE_URL) < list(paths).index(f"{OPTIONS_URL}/{{option_id}}")
    operation = paths[TREE_URL]["get"]
    root_parameter = next(parameter for parameter in operation["parameters"] if parameter["name"] == "root_id")
    assert root_parameter["in"] == "query"
    assert root_parameter["required"] is True
    assert root_parameter["schema"]["type"] == "string"
    assert root_parameter["schema"]["format"] == "uuid"
    for status in ("404", "422"):
        assert operation["responses"][status]["content"]["application/json"]["schema"]["$ref"].endswith("ErrorResponse")
    response_schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
    components = schema["components"]["schemas"]
    tree = components[response_schema["$ref"].rsplit("/", 1)[1]]
    summary = components["OptionSummaryResponse"]
    assert set(tree["properties"]) == set(summary["properties"]) | {"children"}
    assert "children" in tree["required"]
    assert tree["properties"]["children"]["type"] == "array"
    assert tree["properties"]["children"]["items"] == response_schema
    assert tree["properties"]["metrics"]["$ref"].endswith("MassingMetrics")
