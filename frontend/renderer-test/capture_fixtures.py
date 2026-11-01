"""Capture renderer examples through the backend's preview mapping."""

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.application.massing import preview_massing  # noqa: E402
from app.v1.massing import preview_arguments  # noqa: E402
from app.v1.schemas.massing import MassingPreviewRequest, MassingPreviewResponse  # noqa: E402


def supplied_site(name: str) -> dict[str, object]:
    vertices = json.loads((ROOT / "data" / "sites" / f"{name}.json").read_text())["polygon"]
    return {"type": "Polygon", "coordinates": [[*vertices, vertices[0]]]}


rectangle = supplied_site("rectangle")
regular_vertices = [[20 * math.cos(index * 2 * math.pi / 256), 20 * math.sin(index * 2 * math.pi / 256)]
                    for index in range(256)]
regular_site = {"type": "Polygon", "coordinates": [[*regular_vertices, regular_vertices[0]]]}
constraints = {"setback_m": 3, "floor_to_floor_m": 3.5, "max_floors": 6}
requests = {
    "rectangle": {"site": rectangle, "hard_constraints": constraints},
    "l-shaped": {"site": supplied_site("l-shaped"), "hard_constraints": constraints},
    "empty": {"site": rectangle, "hard_constraints": {**constraints, "setback_m": 100}},
    "zero-floors": {
        "site": rectangle,
        "hard_constraints": {"setback_m": 3, "floor_to_floor_m": 3.5, "max_height_m": 3},
    },
    "tall": {"site": rectangle, "hard_constraints": {**constraints, "max_floors": 80}},
    "floor-limit": {"site": rectangle, "hard_constraints": {**constraints, "max_floors": 512}},
    "beyond-floor-limit": {"site": rectangle, "hard_constraints": {**constraints, "max_floors": 513}},
    "triangle-limit": {
        "site": regular_site,
        "hard_constraints": {"setback_m": 0, "floor_to_floor_m": 3.5, "max_floors": 490},
    },
    "beyond-triangle-limit": {
        "site": regular_site,
        "hard_constraints": {"setback_m": 0, "floor_to_floor_m": 3.5, "max_floors": 491},
    },
    "single-floor": {"site": rectangle, "hard_constraints": {**constraints, "max_floors": 1}},
    "target-floors": {
        "site": rectangle,
        "hard_constraints": constraints,
        "targets": {"gfa_target_m2": 2000},
    },
    "translated": {
        "site": {
            "type": "Polygon",
            "coordinates": [[[1e9, -1e9], [1e9 + 40, -1e9], [1e9 + 40, -1e9 + 25],
                             [1e9, -1e9 + 25], [1e9, -1e9]]],
        },
        "hard_constraints": constraints,
    },
    "small-scale": {
        "site": {
            "type": "Polygon",
            "coordinates": [[[0, 0], [0.04, 0], [0.04, 0.025], [0, 0.025], [0, 0]]],
        },
        "hard_constraints": {"setback_m": 0.003, "floor_to_floor_m": 0.0035, "max_floors": 6},
    },
}

responses = {}
for name, payload in requests.items():
    request = MassingPreviewRequest.model_validate(payload)
    result = preview_massing(request.site.model_dump(), **preview_arguments(request))
    responses[name] = MassingPreviewResponse.model_validate(result).model_dump(mode="json")

(Path(__file__).parent / "backendFixtures.json").write_text(json.dumps(responses, indent=2) + "\n")
