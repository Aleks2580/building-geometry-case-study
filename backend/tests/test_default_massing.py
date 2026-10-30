import json
from pathlib import Path

import pytest
from shapely.errors import GEOSException
from shapely.geometry import Polygon, box

import app.geometry.footprints as footprints
import app.massing.defaults as defaults
from app.geometry import FootprintLimits, InvalidSetback, InvalidSiteGeometry, parse_site_geometry
from app.massing import FloorLimits, NumericalRangeError, generate_default_massing


def _sample_site(name: str) -> Polygon:
    fixture = Path(__file__).resolve().parents[2] / "data" / "sites" / f"{name}.json"
    vertices = json.loads(fixture.read_text())["polygon"]
    return parse_site_geometry({"type": "Polygon", "coordinates": [[*vertices, vertices[0]]]})


def _dumbbell_site() -> Polygon:
    left = box(0, 0, 20, 20)
    right = box(30, 0, 50, 20)
    corridor = box(20, 9, 30, 11)
    return left.union(right).union(corridor)


def _floor_limits() -> FloorLimits:
    return FloorLimits(floor_to_floor_m=3.5, max_height_m=24, max_floors=6)


def test_rectangular_default_massing_has_independent_metrics() -> None:
    result = generate_default_massing(
        _sample_site("rectangle"),
        setback_m=3,
        footprint_limits=FootprintLimits(),
        floor_limits=_floor_limits(),
    )

    assert result.site_geometry.area == 1000
    assert result.setback_result.selected_buildable_area_m2 == 646
    assert result.maximum_permitted_floor_count == result.floor_count == 6
    assert result.footprint_area_upper_bound_m2 == 646
    assert result.gfa_upper_bound_m2 == 3876
    assert result.generated_footprint_area_m2 == 646
    assert result.generated_gfa_capacity_m2 == 3876
    assert result.footprint_geometry.equals(box(3, 3, 37, 22))
    assert result.floor_plate_geometry is result.footprint_geometry
    assert result.footprint_area_m2 == result.footprint_geometry.area == 646
    assert result.height_m == 21
    assert result.gfa_m2 == 3876
    assert result.site_coverage_ratio == pytest.approx(0.646)
    assert result.status == "feasible"
    assert result.hard_constraints_satisfied is True
    assert result.reason is None


def test_binding_footprint_limit_uses_measured_area_for_gfa() -> None:
    result = generate_default_massing(
        _sample_site("rectangle"),
        setback_m=3,
        footprint_limits=FootprintLimits(max_footprint_area_m2=500),
        floor_limits=_floor_limits(),
    )

    assert result.footprint_area_upper_bound_m2 == 500
    assert result.gfa_upper_bound_m2 == 3000
    assert result.generated_footprint_area_m2 == pytest.approx(500, abs=1e-8)
    assert result.footprint_area_m2 == result.generated_footprint_area_m2
    assert result.gfa_m2 == pytest.approx(result.footprint_area_m2 * 6)
    assert result.generated_gfa_capacity_m2 == result.gfa_m2
    assert result.gfa_m2 <= result.gfa_upper_bound_m2


def test_split_setback_uses_selected_component_and_preserves_diagnostics() -> None:
    result = generate_default_massing(
        _sample_site("notched"),
        setback_m=3,
        footprint_limits=FootprintLimits(),
        floor_limits=FloorLimits(3.5, max_floors=2),
    )

    assert result.setback_result.buildable_area_m2 == 392
    assert result.setback_result.selected_buildable_area_m2 == 196
    assert result.setback_result.component_count == 2
    assert [diagnostic.code for diagnostic in result.setback_result.diagnostics] == ["BUILDABLE_REGION_SPLIT"]
    assert result.generated_footprint_area_m2 == 196
    assert result.gfa_m2 == 392
    assert result.footprint_result is not None
    assert result.footprint_result.secondary_component_count == 1
    assert result.status == "feasible"


def test_holed_site_keeps_holes_and_uses_hole_aware_coverage() -> None:
    site = Polygon(box(0, 0, 20, 20).exterior.coords, [box(8, 8, 12, 12).exterior.coords])
    result = generate_default_massing(
        site,
        setback_m=2,
        footprint_limits=FootprintLimits(),
        floor_limits=FloorLimits(3.5, max_floors=2),
    )

    assert result.site_geometry.area == 384
    assert result.footprint_geometry is not None
    assert len(result.footprint_geometry.interiors) == 1
    assert result.footprint_area_m2 == 192
    assert result.gfa_m2 == 384
    assert result.site_coverage_ratio == pytest.approx(0.5)


def test_heuristic_undershoot_remains_a_feasible_default() -> None:
    result = generate_default_massing(
        _dumbbell_site(),
        setback_m=0,
        footprint_limits=FootprintLimits(max_footprint_area_m2=350),
        floor_limits=FloorLimits(3.5, max_floors=2),
    )

    assert result.status == "feasible"
    assert result.hard_constraints_satisfied is True
    assert result.generated_gfa_capacity_m2 < result.gfa_upper_bound_m2
    assert result.reason is None
    assert result.footprint_result is not None
    assert result.footprint_result.secondary_component_count == 2
    assert result.footprint_result.secondary_discarded_area_m2 > 0


def test_empty_buildable_region_skips_footprint_construction(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_if_called(*args: object, **kwargs: object) -> object:
        raise AssertionError("footprint construction must be skipped")

    monkeypatch.setattr(defaults, "generate_footprint", fail_if_called)
    result = generate_default_massing(
        box(0, 0, 10, 10),
        setback_m=5,
        footprint_limits=FootprintLimits(),
        floor_limits=FloorLimits(3.5, max_floors=6),
    )

    assert result.status == "infeasible"
    assert result.hard_constraints_satisfied is False
    assert result.reason == "EMPTY_BUILDABLE_REGION"
    assert result.footprint_result is None
    assert result.footprint_area_upper_bound_m2 == result.gfa_upper_bound_m2 == 0
    assert result.generated_footprint_geometry is None
    assert result.generated_footprint_area_m2 is None
    assert result.generated_gfa_capacity_m2 is None
    assert result.footprint_area_m2 is None
    assert result.floor_count is None
    assert result.height_m is None
    assert result.gfa_m2 is None
    assert result.site_coverage_ratio is None


def test_zero_permitted_floors_skips_footprint_construction(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_if_called(*args: object, **kwargs: object) -> object:
        raise AssertionError("footprint construction must be skipped")

    monkeypatch.setattr(defaults, "generate_footprint", fail_if_called)
    result = generate_default_massing(
        box(0, 0, 10, 10),
        setback_m=0,
        footprint_limits=FootprintLimits(),
        floor_limits=FloorLimits(3.5, max_height_m=3.49),
    )

    assert result.status == "infeasible"
    assert result.hard_constraints_satisfied is False
    assert result.reason == "ZERO_PERMITTED_FLOORS"
    assert result.maximum_permitted_floor_count == 0
    assert result.setback_result.selected_buildable_area_m2 == 100
    assert result.footprint_result is None
    assert result.gfa_upper_bound_m2 == 0
    assert result.footprint_geometry is None


def test_generation_failure_preserves_context_without_claiming_infeasibility(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(footprints, "MAX_FOOTPRINT_SEARCH_ITERATIONS", 0)
    result = generate_default_massing(
        box(0, 0, 10, 10),
        setback_m=0,
        footprint_limits=FootprintLimits(max_footprint_area_m2=50),
        floor_limits=FloorLimits(3.5, max_floors=2),
    )

    assert result.status == "generation_failed"
    assert result.hard_constraints_satisfied is None
    assert result.reason == "FOOTPRINT_NOT_GENERATED"
    assert result.footprint_result is not None
    assert result.footprint_result.outcome == "generation_failed"
    assert result.footprint_area_upper_bound_m2 == 50
    assert result.gfa_upper_bound_m2 == 100
    assert result.generated_gfa_capacity_m2 is None
    assert result.footprint_geometry is None
    assert result.floor_count is None
    assert result.gfa_m2 is None


def test_unexpected_geometry_error_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_geos_error(*args: object, **kwargs: object) -> Polygon:
        raise GEOSException("synthetic buffer failure")

    monkeypatch.setattr(Polygon, "buffer", raise_geos_error)

    with pytest.raises(GEOSException, match="synthetic buffer failure"):
        generate_default_massing(
            box(0, 0, 10, 10),
            setback_m=0,
            footprint_limits=FootprintLimits(max_footprint_area_m2=50),
            floor_limits=FloorLimits(3.5, max_floors=2),
        )


def test_invalid_site_and_setback_are_not_hidden_by_zero_floors() -> None:
    invalid_site = Polygon([(0, 0), (2, 2), (0, 2), (2, 0), (0, 0)])
    zero_floors = FloorLimits(3.5, max_height_m=3.49)

    with pytest.raises(InvalidSiteGeometry):
        generate_default_massing(
            invalid_site,
            setback_m=0,
            footprint_limits=FootprintLimits(),
            floor_limits=zero_floors,
        )
    with pytest.raises(InvalidSetback):
        generate_default_massing(
            box(0, 0, 10, 10),
            setback_m=-1,
            footprint_limits=FootprintLimits(),
            floor_limits=zero_floors,
        )


def test_stored_float_36_over_3_6_uses_nine_floors_everywhere() -> None:
    result = generate_default_massing(
        box(0, 0, 10, 10),
        setback_m=0,
        footprint_limits=FootprintLimits(),
        floor_limits=FloorLimits(3.6, max_height_m=36.0),
    )

    assert result.maximum_permitted_floor_count == 9
    assert result.floor_count == 9
    assert result.height_m == pytest.approx(9 * 3.6)
    assert result.height_m <= 36.0
    assert result.gfa_m2 == pytest.approx(result.footprint_area_m2 * 9)


def test_metric_product_preserves_large_count_finite_product() -> None:
    smallest_positive = 5e-324

    assert defaults._multiply_metric(smallest_positive, 2**1074, metric_name="test_metric") == 1.0


def test_unrepresentable_derived_metric_raises_explicit_error() -> None:
    with pytest.raises(NumericalRangeError, match="gfa_upper_bound_m2"):
        generate_default_massing(
            box(0, 0, 1, 1),
            setback_m=0,
            footprint_limits=FootprintLimits(),
            floor_limits=FloorLimits(3.5, max_floors=10**400),
        )
