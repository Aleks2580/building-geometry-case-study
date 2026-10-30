import json
from pathlib import Path

import pytest
from shapely.geometry import Polygon, box, shape

import app.application.massing as application
import app.geometry.footprints as footprints
import app.massing.area_preferences as area_preferences
from app.geometry import FootprintLimits, FootprintResult, InvalidSiteGeometry, serialize_site_geometry
from app.massing import (
    DesignPreferences,
    DesignTargets,
    FloorLimits,
    NumericalRangeError,
    PreferenceExceedsHardLimit,
)


def _site(name: str = "rectangle") -> dict:
    fixture = Path(__file__).resolve().parents[2] / "data" / "sites" / f"{name}.json"
    vertices = json.loads(fixture.read_text())["polygon"]
    return {"type": "Polygon", "coordinates": [[*vertices, vertices[0]]]}


def _preview(
    *,
    site: object | None = None,
    setback_m: float = 3,
    footprint_limits: FootprintLimits | None = None,
    floor_limits: FloorLimits | None = None,
    preferences: DesignPreferences | None = None,
    targets: DesignTargets | None = None,
) -> dict:
    return application.preview_massing(
        _site() if site is None else site,
        setback_m=setback_m,
        footprint_limits=footprint_limits or FootprintLimits(),
        floor_limits=floor_limits or FloorLimits(3.5, max_floors=6),
        preferences=preferences or DesignPreferences(),
        targets=targets or DesignTargets(),
    )


def test_preview_calls_domain_service_and_maps_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    original = application.generate_massing_with_preferences
    calls = []

    def generate(site, **kwargs):
        calls.append((site, kwargs))
        return original(site, **kwargs)

    monkeypatch.setattr(application, "generate_massing_with_preferences", generate)
    result = _preview(
        footprint_limits=FootprintLimits(site_coverage_ratio=0.6, max_footprint_area_m2=500),
        floor_limits=FloorLimits(3.5, max_height_m=24, max_floors=6),
        preferences=DesignPreferences(preferred_floor_count=4),
        targets=DesignTargets(gfa_target_m2=1000),
    )

    assert len(calls) == 1
    assert isinstance(calls[0][0], Polygon)
    assert calls[0][1]["footprint_limits"].max_footprint_area_m2 == 500
    assert result["site"] == result["site_geometry"]
    assert result["hard_constraints"] == {
        "setback_m": 3,
        "floor_to_floor_m": 3.5,
        "max_height_m": 24,
        "max_floors": 6,
        "site_coverage_ratio": 0.6,
        "max_footprint_m2": 500,
    }
    assert result["preferences"] == {"preferred_floor_count": 4, "preferred_footprint_area_m2": None}
    assert result["targets"] == {"gfa_target_m2": 1000}
    assert json.loads(json.dumps(result, allow_nan=False)) == result


def test_actual_metrics_are_distinct_from_generated_capacity() -> None:
    result = _preview(preferences=DesignPreferences(preferred_floor_count=4, preferred_footprint_area_m2=400))
    metrics = result["metrics"]
    area = shape(result["footprint_geometry"]).area

    assert metrics["site_area_m2"] == 1000
    assert metrics["buildable_area_m2"] == metrics["selected_buildable_area_m2"] == 646
    assert metrics["footprint_area_upper_bound_m2"] == metrics["generated_footprint_area_m2"] == 646
    assert metrics["gfa_upper_bound_m2"] == metrics["generated_gfa_capacity_m2"] == 3876
    assert metrics["maximum_permitted_floor_count"] == 6
    assert metrics["floor_count"] == 4
    assert metrics["floor_to_floor_m"] == 3.5
    assert metrics["height_m"] == 14
    assert metrics["footprint_area_m2"] == area
    assert metrics["gfa_m2"] == area * 4
    assert metrics["site_coverage_ratio"] == area / 1000
    assert result["floor_plate_geometry"] == result["footprint_geometry"]
    assert result["generated_footprint_geometry"] != result["footprint_geometry"]
    assert result["preference_results"]["preferred_floor_count"] == 4
    assert result["preference_results"]["footprint_area"]["actual_area_m2"] == area
    assert result["feasibility"]["status"] == "feasible"


def test_holed_polygon_serializes_every_ring_without_precision_loss() -> None:
    site = Polygon(box(0, 0, 20.12345678912345, 20).exterior.coords, [box(8, 8, 12, 12).exterior.coords])
    result = _preview(site=serialize_site_geometry(site), setback_m=0)

    for field in ("site_geometry", "buildable_geometry", "selected_buildable_geometry", "footprint_geometry"):
        geometry = result[field]
        assert geometry["type"] == "Polygon"
        assert len(geometry["coordinates"]) == 2
        assert shape(geometry).area == site.area
        assert all(ring[0] == ring[-1] for ring in geometry["coordinates"])
    assert max(position[0] for position in result["site_geometry"]["coordinates"][0]) == 20.12345678912345


def test_split_setback_preserves_full_region_and_selection_accounting() -> None:
    result = _preview(site=_site("notched"))

    assert result["buildable_geometry"]["type"] == "MultiPolygon"
    assert result["selected_buildable_geometry"]["type"] == "Polygon"
    assert result["setback"]["component_count"] == 2
    assert result["setback"]["discarded_area_m2"] > 0
    assert result["setback"]["retained_area_m2"] == result["metrics"]["selected_buildable_area_m2"]
    assert result["metrics"]["buildable_area_m2"] == shape(result["buildable_geometry"]).area
    assert [item["code"] for item in result["feasibility"]["diagnostics"]] == ["BUILDABLE_REGION_SPLIT"]


@pytest.mark.parametrize(
    ("setback_m", "floor_limits", "reason", "empty"),
    [
        (30, FloorLimits(3.5, max_floors=6), "EMPTY_BUILDABLE_REGION", True),
        (0, FloorLimits(3.5, max_height_m=3), "ZERO_PERMITTED_FLOORS", False),
    ],
)
def test_infeasible_result_has_null_building_and_preserved_context(
    setback_m: float, floor_limits: FloorLimits, reason: str, empty: bool
) -> None:
    result = _preview(setback_m=setback_m, floor_limits=floor_limits, targets=DesignTargets(0))
    feasibility = result["feasibility"]

    assert feasibility["status"] == "infeasible"
    assert feasibility["reason"] == reason
    assert feasibility["hard_constraints_satisfied"] is False
    assert [item["code"] for item in feasibility["diagnostics"]] == [reason]
    assert feasibility["target_assessment"] == {
        "requested_m2": 0,
        "actual_m2": None,
        "shortfall_m2": None,
        "status": "not_evaluated",
        "diagnostic_code": None,
    }
    assert (result["buildable_geometry"] is None) == empty
    assert result["site_geometry"] is not None
    for field in ("generated_footprint_geometry", "footprint_geometry", "floor_plate_geometry"):
        assert result[field] is None
    for field in ("footprint_area_m2", "floor_count", "height_m", "gfa_m2", "generated_gfa_capacity_m2"):
        assert result["metrics"][field] is None


def test_generation_failure_is_not_reported_as_infeasibility(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(footprints, "MAX_FOOTPRINT_SEARCH_ITERATIONS", 0)
    result = _preview(footprint_limits=FootprintLimits(max_footprint_area_m2=500))

    assert result["feasibility"]["status"] == "generation_failed"
    assert result["feasibility"]["hard_constraints_satisfied"] is None
    assert result["feasibility"]["reason"] == "FOOTPRINT_NOT_GENERATED"
    assert result["metrics"]["footprint_area_upper_bound_m2"] == 500
    assert result["metrics"]["gfa_upper_bound_m2"] == 3000
    assert result["metrics"]["generated_gfa_capacity_m2"] is None
    assert result["footprint_geometry"] is None


@pytest.mark.parametrize(
    ("target", "preferences", "expected_code"),
    [
        (4000, DesignPreferences(), "TARGET_EXCEEDS_UPPER_BOUND"),
        (3000, DesignPreferences(preferred_floor_count=2), "TARGET_UNMET_WITH_PREFERENCES"),
    ],
)
def test_unmet_target_maps_measured_assessment_and_diagnostic(target, preferences, expected_code) -> None:
    result = _preview(targets=DesignTargets(target), preferences=preferences)
    feasibility = result["feasibility"]
    assessment = feasibility["target_assessment"]

    assert feasibility["status"] == "feasible_target_unmet"
    assert feasibility["hard_constraints_satisfied"] is True
    assert assessment["requested_m2"] == target
    assert assessment["actual_m2"] == result["metrics"]["gfa_m2"]
    assert assessment["shortfall_m2"] == target - result["metrics"]["gfa_m2"]
    assert assessment["status"] == "unmet"
    assert assessment["diagnostic_code"] == expected_code
    diagnostic = feasibility["diagnostics"][-1]
    assert diagnostic["code"] == expected_code
    assert diagnostic["path"] == "targets.gfa_target_m2"
    assert diagnostic["details"]["shortfall_m2"] == assessment["shortfall_m2"]


def test_clamped_preference_keeps_requested_effective_and_actual_values() -> None:
    result = _preview(
        footprint_limits=FootprintLimits(max_footprint_area_m2=500),
        preferences=DesignPreferences(preferred_footprint_area_m2=600),
    )
    area = result["preference_results"]["footprint_area"]

    assert area["status"] == "clamped"
    assert area["original_hard_area_upper_bound_m2"] == area["effective_target_m2"] == 500
    assert area["requested_area_m2"] == 600
    assert area["actual_area_m2"] == result["metrics"]["footprint_area_m2"]
    assert area["difference_m2"] == area["actual_area_m2"] - 600
    assert area["effective_target_undershoot_m2"] == 500 - area["actual_area_m2"]
    assert area["diagnostic_codes"] == ["PREFERENCE_CLAMPED_TO_HARD_CAP"]
    assert result["feasibility"]["diagnostics"][0]["path"] == "preferences.preferred_footprint_area_m2"


def test_approximated_preference_reports_target_beyond_generated_capacity() -> None:
    site = box(0, 0, 20, 20).union(box(30, 0, 50, 20)).union(box(20, 9, 30, 11))
    result = _preview(
        site=serialize_site_geometry(site),
        setback_m=0,
        footprint_limits=FootprintLimits(max_footprint_area_m2=350),
        floor_limits=FloorLimits(3.5, max_floors=2),
        preferences=DesignPreferences(preferred_footprint_area_m2=350),
        targets=DesignTargets(690),
    )

    assert result["preference_results"]["footprint_area"]["status"] == "approximated"
    assert result["feasibility"]["status"] == "feasible_target_unmet"
    assert result["feasibility"]["target_assessment"]["diagnostic_code"] == "TARGET_BEYOND_GENERATED_CAPACITY"
    assert [item["code"] for item in result["feasibility"]["diagnostics"]] == [
        "FOOTPRINT_AREA_APPROXIMATED",
        "TARGET_BEYOND_GENERATED_CAPACITY",
    ]


def test_failed_preferred_construction_retains_default_capacity_without_duplicate_diagnostic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failed = FootprintResult(400, None, None, "generation_failed", 0, 0, None)
    monkeypatch.setattr(area_preferences, "generate_footprint", lambda *args, **kwargs: failed)
    result = _preview(preferences=DesignPreferences(preferred_footprint_area_m2=400))

    assert result["feasibility"]["status"] == "generation_failed"
    assert result["feasibility"]["hard_constraints_satisfied"] is None
    assert [item["code"] for item in result["feasibility"]["diagnostics"]] == ["PREFERRED_FOOTPRINT_NOT_GENERATED"]
    assert result["preference_results"]["footprint_area"]["status"] == "unmet"
    assert result["preference_results"]["footprint_area"]["actual_area_m2"] is None
    assert result["generated_footprint_geometry"] is not None
    assert result["metrics"]["generated_gfa_capacity_m2"] == 3876
    assert result["footprint_geometry"] is None
    assert result["metrics"]["gfa_m2"] is None


def test_large_integer_floor_count_survives_plain_json_round_trip() -> None:
    count = 2**1074
    result = _preview(
        site=serialize_site_geometry(box(0, 0, 1e-160, 1e-160)),
        setback_m=0,
        floor_limits=FloorLimits(5e-324, max_floors=count),
        preferences=DesignPreferences(preferred_floor_count=count),
    )

    encoded = json.loads(json.dumps(result, allow_nan=False))
    assert encoded["metrics"]["floor_count"] == count
    assert encoded["metrics"]["height_m"] == 1
    assert encoded["metrics"]["gfa_m2"] == 2024


def test_application_preserves_domain_errors_for_transport_translation() -> None:
    with pytest.raises(InvalidSiteGeometry):
        _preview(site={"type": "Polygon", "coordinates": []})
    with pytest.raises(PreferenceExceedsHardLimit):
        _preview(preferences=DesignPreferences(preferred_floor_count=7))
    with pytest.raises(NumericalRangeError):
        _preview(floor_limits=FloorLimits(3.5, max_floors=10**400))
