import json
from dataclasses import replace
from math import sqrt
from pathlib import Path

import pytest
from shapely.errors import GEOSException
from shapely.geometry import Polygon, box

import app.geometry.footprints as footprints
from app.geometry import (
    FootprintLimits,
    FootprintResult,
    InvalidFootprintLimits,
    InvalidSiteGeometry,
    calculate_footprint_area_upper_bound,
    calculate_setback,
    generate_footprint,
    normalize_polygon,
    parse_site_geometry,
    serialize_site_geometry,
)
from app.geometry.tolerances import area_tolerance_m2


def _sample_site(name: str) -> Polygon:
    fixture = Path(__file__).resolve().parents[2] / "data" / "sites" / f"{name}.json"
    vertices = json.loads(fixture.read_text())["polygon"]
    return parse_site_geometry({"type": "Polygon", "coordinates": [[*vertices, vertices[0]]]})


def test_no_area_limits_use_selected_buildable_area() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 3)

    assert calculate_footprint_area_upper_bound(setback, FootprintLimits()) == 646


def test_coverage_only_uses_original_site_area() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 1)

    assert setback.site_area_m2 == 1000
    assert setback.selected_buildable_area_m2 == 874
    assert calculate_footprint_area_upper_bound(setback, FootprintLimits(site_coverage_ratio=0.6)) == 600


def test_maximum_footprint_only_caps_selected_component() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 1)

    assert calculate_footprint_area_upper_bound(setback, FootprintLimits(max_footprint_area_m2=500)) == 500


def test_smallest_area_limit_wins() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 1)

    limits = FootprintLimits(site_coverage_ratio=0.6, max_footprint_area_m2=700)
    assert calculate_footprint_area_upper_bound(setback, limits) == 600


def test_coverage_cap_uses_hole_aware_original_site_area() -> None:
    site = Polygon(box(0, 0, 20, 20).exterior.coords, [box(8, 8, 12, 12).exterior.coords])
    setback = calculate_setback(site, 2)

    assert setback.site_area_m2 == 384
    assert setback.selected_buildable_area_m2 == 192
    assert calculate_footprint_area_upper_bound(setback, FootprintLimits(site_coverage_ratio=0.25)) == 96


def test_split_buildable_region_uses_selected_component() -> None:
    setback = calculate_setback(_sample_site("notched"), 3)

    assert setback.buildable_area_m2 == 392
    assert setback.selected_buildable_area_m2 == 196
    assert calculate_footprint_area_upper_bound(setback, FootprintLimits()) == 196


def test_empty_setback_has_zero_upper_bound_without_geometry() -> None:
    setback = calculate_setback(box(0, 0, 10, 10), 5)

    assert setback.buildable_geometry.is_empty
    assert setback.selected_buildable_geometry is None
    assert calculate_footprint_area_upper_bound(setback, FootprintLimits()) == 0.0


@pytest.mark.parametrize(
    "value",
    [0, -1, 2, True, False, "0.5", float("nan"), float("inf"), -float("inf"), 10**400],
)
def test_invalid_site_coverage_ratio_is_rejected(value: object) -> None:
    with pytest.raises(InvalidFootprintLimits):
        FootprintLimits(site_coverage_ratio=value)


@pytest.mark.parametrize(
    "value",
    [0, -1, True, False, "500", float("nan"), float("inf"), -float("inf"), 10**400],
)
def test_invalid_max_footprint_area_is_rejected(value: object) -> None:
    with pytest.raises(InvalidFootprintLimits):
        FootprintLimits(max_footprint_area_m2=value)


def test_footprint_limits_are_immutable() -> None:
    limits = FootprintLimits(site_coverage_ratio=0.5, max_footprint_area_m2=500)

    with pytest.raises(AttributeError):
        limits.site_coverage_ratio = 0.6  # type: ignore[misc]


def test_no_limits_return_canonical_selected_component_without_buffering(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    site = Polygon(
        [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)],
        [[(3, 3), (3, 7), (7, 7), (7, 3), (3, 3)]],
    )
    setback = calculate_setback(site, 0)
    raw_selected = Polygon(
        [(10, 10), (10, 0), (5, 0), (0, 0), (0, 10), (10, 10)],
        [[(7, 7), (7, 3), (3, 3), (3, 7), (7, 7)]],
    )
    noncanonical = replace(setback, selected_buildable_geometry=raw_selected)
    expected = normalize_polygon(raw_selected)

    def fail_buffer(*args: object, **kwargs: object) -> Polygon:
        raise AssertionError("direct footprint construction must not buffer")

    monkeypatch.setattr(Polygon, "buffer", fail_buffer)

    result = generate_footprint(noncanonical, FootprintLimits())
    geometry = result.generated_footprint_geometry

    assert isinstance(result, FootprintResult)
    assert result.outcome == "success"
    assert geometry is not None and geometry is not raw_selected
    assert geometry.is_valid and geometry.equals(expected)
    assert list(geometry.exterior.coords) == list(expected.exterior.coords)
    assert list(geometry.interiors[0].coords) == list(expected.interiors[0].coords)
    assert (5.0, 0.0) in geometry.exterior.coords
    assert len(geometry.interiors) == 1
    assert result.footprint_area_upper_bound_m2 == pytest.approx(expected.area)
    assert result.generated_footprint_area_m2 == pytest.approx(geometry.area)
    assert result.secondary_component_count == 1
    assert result.secondary_discarded_area_m2 == 0
    assert result.undershoot_m2 == 0

    with pytest.raises(AttributeError):
        result.outcome = "generation_failed"  # type: ignore[misc]


def test_non_binding_limit_and_exact_selected_cap_preserve_geometry() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 3)
    expected = serialize_site_geometry(setback.selected_buildable_geometry)

    for limits in [
        FootprintLimits(max_footprint_area_m2=647),
        FootprintLimits(max_footprint_area_m2=646),
    ]:
        result = generate_footprint(setback, limits)

        assert result.outcome == "success"
        assert serialize_site_geometry(result.generated_footprint_geometry) == expected
        assert result.generated_footprint_area_m2 == 646
        assert result.undershoot_m2 == 0


@pytest.mark.parametrize(
    "limits, expected_cap",
    [(FootprintLimits(site_coverage_ratio=0.6), 600), (FootprintLimits(max_footprint_area_m2=500), 500)],
)
def test_rectangle_reduction_respects_each_area_cap(limits: FootprintLimits, expected_cap: float) -> None:
    setback = calculate_setback(_sample_site("rectangle"), 1)
    result = generate_footprint(setback, limits)
    geometry = result.generated_footprint_geometry

    assert result.outcome == "success"
    assert geometry is not None
    assert geometry.is_valid and geometry.area > 0
    assert setback.selected_buildable_geometry.covers(geometry)
    assert result.generated_footprint_area_m2 == pytest.approx(geometry.area)
    assert result.generated_footprint_area_m2 <= expected_cap
    assert result.generated_footprint_area_m2 == pytest.approx(expected_cap, abs=1e-8)
    assert result.undershoot_m2 == pytest.approx(expected_cap - geometry.area)


def test_rectangle_coverage_and_maximum_use_the_tighter_cap() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 1)
    result = generate_footprint(
        setback,
        FootprintLimits(site_coverage_ratio=0.6, max_footprint_area_m2=500),
    )

    assert result.outcome == "success"
    assert result.generated_footprint_area_m2 == pytest.approx(500, abs=1e-8)


def test_rectangle_reduction_matches_independent_offset_dimensions() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 1)
    result = generate_footprint(setback, FootprintLimits(max_footprint_area_m2=500))
    geometry = result.generated_footprint_geometry
    assert geometry is not None

    width, height = 38.0, 23.0
    cap = 500.0
    expected_distance = (width + height - sqrt((width + height) ** 2 - 4 * (width * height - cap))) / 4
    assert geometry.bounds == pytest.approx(
        (1 + expected_distance, 1 + expected_distance, 39 - expected_distance, 24 - expected_distance),
        abs=1e-8,
    )


def test_concave_component_is_reduced_and_contained() -> None:
    setback = calculate_setback(_sample_site("l-shaped"), 3)
    result = generate_footprint(setback, FootprintLimits(max_footprint_area_m2=300))
    geometry = result.generated_footprint_geometry

    assert result.outcome == "success"
    assert geometry is not None and geometry.is_valid and geometry.area > 0
    assert setback.selected_buildable_geometry.covers(geometry)
    assert result.generated_footprint_area_m2 == pytest.approx(geometry.area)
    assert result.generated_footprint_area_m2 <= result.footprint_area_upper_bound_m2


def test_holed_component_keeps_a_positive_hole() -> None:
    site = Polygon(box(0, 0, 20, 20).exterior.coords, [box(8, 8, 12, 12).exterior.coords])
    setback = calculate_setback(site, 2)
    result = generate_footprint(setback, FootprintLimits(max_footprint_area_m2=100))
    geometry = result.generated_footprint_geometry

    assert result.outcome == "success"
    assert geometry is not None and geometry.is_valid and geometry.area > 0
    assert len(geometry.interiors) == 1
    assert setback.selected_buildable_geometry.covers(geometry)
    assert result.generated_footprint_area_m2 == pytest.approx(geometry.area)
    assert result.generated_footprint_area_m2 <= 100


def test_split_setback_uses_only_its_selected_component() -> None:
    setback = calculate_setback(_sample_site("notched"), 3)
    result = generate_footprint(setback, FootprintLimits())

    assert result.outcome == "success"
    assert result.footprint_area_upper_bound_m2 == setback.selected_buildable_area_m2 == 196
    assert result.generated_footprint_area_m2 == 196
    assert result.secondary_component_count == 1


def _dumbbell_site() -> Polygon:
    left = box(0, 0, 20, 20)
    right = box(30, 0, 50, 20)
    corridor = box(20, 9, 30, 11)
    return left.union(right).union(corridor)


def test_secondary_split_metadata_is_deterministic() -> None:
    setback = calculate_setback(_dumbbell_site(), 0)
    first = generate_footprint(setback, FootprintLimits(max_footprint_area_m2=350))
    second = generate_footprint(setback, FootprintLimits(max_footprint_area_m2=350))

    assert first.outcome == second.outcome == "success"
    assert first.footprint_area_upper_bound_m2 == second.footprint_area_upper_bound_m2
    assert first.generated_footprint_area_m2 == pytest.approx(second.generated_footprint_area_m2)
    assert first.secondary_component_count == second.secondary_component_count == 2
    assert first.secondary_discarded_area_m2 == pytest.approx(second.secondary_discarded_area_m2)
    assert first.undershoot_m2 == pytest.approx(second.undershoot_m2)
    assert first.secondary_discarded_area_m2 > 0
    assert first.secondary_discarded_area_m2 == pytest.approx(first.generated_footprint_area_m2)
    assert serialize_site_geometry(first.generated_footprint_geometry) == serialize_site_geometry(
        second.generated_footprint_geometry
    )


def test_empty_buildable_region_has_no_constructed_geometry() -> None:
    setback = calculate_setback(box(0, 0, 10, 10), 5)
    result = generate_footprint(setback, FootprintLimits(max_footprint_area_m2=10))

    assert result.outcome == "empty_buildable_region"
    assert result.footprint_area_upper_bound_m2 == 0
    assert result.generated_footprint_geometry is None
    assert result.generated_footprint_area_m2 is None
    assert result.undershoot_m2 is None


def test_search_exhaustion_is_an_explicit_construction_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    setback = calculate_setback(box(0, 0, 10, 10), 0)
    monkeypatch.setattr(footprints, "MAX_FOOTPRINT_SEARCH_ITERATIONS", 0)

    result = generate_footprint(setback, FootprintLimits(max_footprint_area_m2=50))

    assert result.outcome == "generation_failed"
    assert result.generated_footprint_geometry is None
    assert result.generated_footprint_area_m2 is None
    assert result.footprint_area_upper_bound_m2 == 50


def test_invalid_selected_input_remains_an_error() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 0)
    invalid = replace(setback, selected_buildable_geometry=Polygon([(0, 0), (1, 0), (2, 0)]))

    with pytest.raises(InvalidSiteGeometry):
        generate_footprint(invalid, FootprintLimits())


def test_geos_error_at_buffer_boundary_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    setback = calculate_setback(_sample_site("rectangle"), 0)

    def raise_geos_error(*args: object, **kwargs: object) -> Polygon:
        raise GEOSException("synthetic buffer failure")

    monkeypatch.setattr(Polygon, "buffer", raise_geos_error)

    with pytest.raises(GEOSException, match="synthetic buffer failure"):
        generate_footprint(setback, FootprintLimits(max_footprint_area_m2=500))


def test_invalid_generated_geometry_at_buffer_boundary_remains_an_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    setback = calculate_setback(_sample_site("rectangle"), 0)
    invalid_polygon = Polygon([(0, 0), (1, 0), (2, 0)])

    def return_invalid_polygon(*args: object, **kwargs: object) -> Polygon:
        return invalid_polygon

    monkeypatch.setattr(Polygon, "buffer", return_invalid_polygon)

    with pytest.raises(RuntimeError, match="invalid non-polygonal geometry"):
        generate_footprint(setback, FootprintLimits(max_footprint_area_m2=500))


def test_small_outside_generated_geometry_is_rejected_by_containment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    setback = calculate_setback(_sample_site("rectangle"), 0)
    outside = box(100, 100, 100.0001, 100.0001)
    assert 0 < outside.area < area_tolerance_m2(setback.site_area_m2)

    def return_outside_polygon(*args: object, **kwargs: object) -> Polygon:
        return outside

    monkeypatch.setattr(Polygon, "buffer", return_outside_polygon)

    with pytest.raises(RuntimeError, match="extends outside"):
        generate_footprint(setback, FootprintLimits(max_footprint_area_m2=500))


def test_generated_geometry_round_trips_with_its_reported_area() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 1)
    result = generate_footprint(setback, FootprintLimits(max_footprint_area_m2=500))
    serialized = serialize_site_geometry(result.generated_footprint_geometry)
    payload = json.dumps(serialized, allow_nan=False)
    restored = parse_site_geometry(json.loads(payload))

    assert restored.is_valid and restored.area > 0
    assert serialize_site_geometry(restored) == serialized
    assert restored.equals(result.generated_footprint_geometry)
    assert restored.area == pytest.approx(result.generated_footprint_geometry.area)
    assert restored.area == pytest.approx(result.generated_footprint_area_m2)
    assert result.generated_footprint_area_m2 <= result.footprint_area_upper_bound_m2
