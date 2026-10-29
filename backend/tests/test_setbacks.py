import json
from itertools import permutations
from pathlib import Path

import pytest
from shapely.geometry import MultiPolygon, Polygon, box, shape

from app.geometry import (
    InvalidSetback,
    InvalidSiteGeometry,
    calculate_setback,
    parse_site_geometry,
    select_largest_component,
    serialize_buildable_geometry,
    serialize_site_geometry,
)
from app.geometry.setbacks import _check_invariants
from app.geometry.tolerances import area_tolerance_m2


def _sample_site(name: str) -> Polygon:
    fixture = Path(__file__).resolve().parents[2] / "data" / "sites" / f"{name}.json"
    vertices = json.loads(fixture.read_text())["polygon"]
    return parse_site_geometry({"type": "Polygon", "coordinates": [[*vertices, vertices[0]]]})


@pytest.mark.parametrize("setback, expected_area", [(1, 874), (3, 646)])
def test_rectangular_setback_matches_independent_dimensions(setback: float, expected_area: float) -> None:
    site = _sample_site("rectangle")
    result = calculate_setback(site, setback)
    expected = box(setback, setback, 40 - setback, 25 - setback)

    assert result.site_area_m2 == 1000
    assert result.buildable_geometry.equals(expected)
    assert result.buildable_geometry.is_valid
    assert site.covers(result.buildable_geometry)
    assert result.buildable_area_m2 == pytest.approx(expected_area)
    assert result.selected_buildable_area_m2 == result.retained_area_m2 == result.buildable_area_m2
    assert result.component_count == 1
    assert result.discarded_area_m2 == 0
    assert result.diagnostics == ()


def test_zero_setback_preserves_holes_and_distinct_collinear_vertices() -> None:
    site = Polygon([(0, 0), (2, 0), (10, 0), (10, 10), (0, 10)], [[(3, 3), (5, 3), (5, 5), (3, 5)]])
    original = serialize_site_geometry(site)

    result = calculate_setback(site, 0)

    assert serialize_buildable_geometry(result.buildable_geometry) == original
    assert serialize_site_geometry(result.selected_buildable_geometry) == original
    assert (2, 0) in result.buildable_geometry.exterior.coords
    assert result.site_area_m2 == result.buildable_area_m2 == result.retained_area_m2 == 96
    assert result.discarded_area_m2 == 0
    assert result.component_count == 1


def test_l_shaped_setback_preserves_the_reflex_corner() -> None:
    site = _sample_site("l-shaped")
    result = calculate_setback(site, 3)
    expected = Polygon([(3, 3), (37, 3), (37, 12), (17, 12), (17, 27), (3, 27)])

    assert result.site_area_m2 == 900
    assert result.buildable_geometry.equals(expected)
    assert result.buildable_geometry.is_valid
    assert result.buildable_area_m2 == 34 * 9 + 14 * 15 == 516
    assert site.covers(result.buildable_geometry)


@pytest.mark.parametrize("setback, component_area", [(3, 196), (4, 144)])
def test_notched_setback_preserves_both_components_and_selects_the_left_tie(
    setback: float, component_area: float
) -> None:
    site = _sample_site("notched")
    result = calculate_setback(site, setback)
    left = box(setback, setback, 20 - setback, 20 - setback)
    right = box(30 + setback, setback, 50 - setback, 20 - setback)

    assert isinstance(result.buildable_geometry, MultiPolygon)
    assert result.buildable_geometry.equals(MultiPolygon([left, right]))
    assert result.buildable_geometry.is_valid
    assert site.covers(result.buildable_geometry)
    assert result.selected_buildable_geometry.equals(left)
    assert result.component_count == 2
    assert result.buildable_area_m2 == 2 * component_area
    assert result.selected_buildable_area_m2 == result.retained_area_m2 == component_area
    assert result.discarded_area_m2 == component_area
    assert sum(component.area for component in result.buildable_geometry.geoms) == result.buildable_area_m2
    assert result.retained_area_m2 + result.discarded_area_m2 == result.buildable_area_m2
    assert [(diagnostic.code, diagnostic.severity) for diagnostic in result.diagnostics] == [
        ("BUILDABLE_REGION_SPLIT", "warning")
    ]

    serialized = serialize_buildable_geometry(result.buildable_geometry)
    restored = shape(json.loads(json.dumps(serialized, allow_nan=False)))
    assert serialized["type"] == "MultiPolygon"
    assert restored.equals(result.buildable_geometry)
    assert restored.area == result.buildable_area_m2
    assert shape(serialize_site_geometry(result.selected_buildable_geometry)).area == result.selected_buildable_area_m2


def test_inward_setback_expands_holes_and_subtracts_their_area() -> None:
    site = Polygon(box(0, 0, 20, 20).exterior.coords, [box(8, 8, 12, 12).exterior.coords])
    result = calculate_setback(site, 2)
    expected = Polygon(box(2, 2, 18, 18).exterior.coords, [box(6, 6, 14, 14).exterior.coords])

    assert result.site_area_m2 == 384
    assert result.buildable_geometry.equals(expected)
    assert result.buildable_geometry.is_valid
    assert len(result.buildable_geometry.interiors) == 1
    assert result.buildable_area_m2 == 16**2 - 8**2 == 192
    assert site.covers(result.buildable_geometry)


def test_empty_setback_has_no_selected_geometry_and_zero_measurements() -> None:
    result = calculate_setback(box(0, 0, 10, 10), 5)

    assert result.buildable_geometry.is_empty
    assert result.selected_buildable_geometry is None
    assert result.buildable_area_m2 == result.selected_buildable_area_m2 == 0
    assert result.retained_area_m2 == result.discarded_area_m2 == 0
    assert result.component_count == 0
    assert serialize_buildable_geometry(result.buildable_geometry) is None
    assert [(diagnostic.code, diagnostic.severity) for diagnostic in result.diagnostics] == [
        ("EMPTY_BUILDABLE_REGION", "info")
    ]
    assert result.diagnostics[0].message


def test_nonempty_geometry_with_zero_measured_area_is_not_buildable() -> None:
    geometry = box(0, 0, 1e-200, 1e-200)

    assert geometry.is_valid
    assert not geometry.is_empty
    assert geometry.area == 0
    assert serialize_buildable_geometry(geometry) is None


def test_narrow_site_retains_a_valid_inset() -> None:
    site = box(0, 0, 100, 0.01)
    result = calculate_setback(site, 0.002)

    assert result.buildable_geometry.equals(box(0.002, 0.002, 99.998, 0.008))
    assert result.buildable_area_m2 == pytest.approx(99.996 * 0.006)
    assert result.component_count == 1
    assert site.covers(result.buildable_geometry)


@pytest.mark.parametrize("setback, expected_area", [(1e-6, 6.4e-11), (4.9e-6, 4e-14)])
def test_positive_near_empty_results_are_not_filtered_by_area_tolerance(setback: float, expected_area: float) -> None:
    site = box(0, 0, 1e-5, 1e-5)
    result = calculate_setback(site, setback)

    assert 0 < result.buildable_area_m2 < area_tolerance_m2(result.site_area_m2)
    assert result.buildable_area_m2 == pytest.approx(expected_area, rel=1e-12, abs=0)
    assert result.buildable_geometry.is_valid
    assert site.covers(result.buildable_geometry)
    assert result.component_count == 1
    assert result.selected_buildable_geometry is not None
    assert result.diagnostics == ()


def test_split_preserves_a_discarded_component_smaller_than_area_tolerance() -> None:
    site = Polygon(
        [
            (0, 0),
            (100, 0),
            (100, 49),
            (110, 49),
            (110, 48),
            (114, 48),
            (114, 52),
            (110, 52),
            (110, 51),
            (100, 51),
            (100, 100),
            (0, 100),
        ]
    )
    result = calculate_setback(site, 1.999)

    assert result.component_count == 2
    assert result.selected_buildable_area_m2 == pytest.approx((100 - 2 * 1.999) ** 2)
    assert 0 < result.discarded_area_m2 < area_tolerance_m2(result.site_area_m2)
    assert result.discarded_area_m2 == pytest.approx((4 - 2 * 1.999) ** 2, rel=1e-9, abs=0)
    assert len(result.buildable_geometry.geoms) == 2
    assert site.covers(result.buildable_geometry)


def test_component_selection_is_independent_of_input_order() -> None:
    left = box(0, 0, 2, 2)
    right = box(10, 0, 12, 2)
    smaller = box(20, 0, 21, 1)

    for candidates in permutations([left, right, smaller]):
        selected = select_largest_component(candidates)
        assert selected.equals(left)

    assert select_largest_component([]) is None
    assert select_largest_component([Polygon(), left]).equals(left)


def test_slightly_larger_component_wins_even_within_area_tolerance() -> None:
    left = box(0, 0, 10, 10)
    larger = box(20, 0, 30 + 1e-10, 10)

    assert 0 < larger.area - left.area < area_tolerance_m2(left.area + larger.area)
    assert select_largest_component([left, larger]).equals(larger)
    assert select_largest_component([larger, left]).equals(larger)


def test_equal_area_and_bounds_use_canonical_numeric_coordinates() -> None:
    plain = box(0, 0, 10, 10)
    with_collinear_vertex = Polygon([(0, 0), (2, 0), (10, 0), (10, 10), (0, 10)])
    expected = serialize_site_geometry(with_collinear_vertex)

    assert plain.area == with_collinear_vertex.area
    assert plain.bounds == with_collinear_vertex.bounds
    for candidates in [[plain, with_collinear_vertex], [with_collinear_vertex, plain]]:
        selected = select_largest_component(candidates)
        assert serialize_site_geometry(selected) == expected


def test_full_region_serialization_has_stable_component_order_and_round_trips() -> None:
    left = box(0, 0, 2, 2)
    right = box(10, 0, 12, 2)
    forward = serialize_buildable_geometry(MultiPolygon([left, right]))
    reversed_order = serialize_buildable_geometry(MultiPolygon([right, left]))

    assert forward == reversed_order
    assert forward["type"] == "MultiPolygon"
    for polygon_coordinates in forward["coordinates"]:
        for ring in polygon_coordinates:
            assert ring[0] == ring[-1]
    restored = shape(json.loads(json.dumps(forward, allow_nan=False)))
    assert restored.is_valid
    assert restored.area == 8
    assert restored.equals(MultiPolygon([left, right]))
    assert serialize_buildable_geometry(restored) == forward


@pytest.mark.parametrize(
    "setback", [-1, -float("inf"), float("inf"), float("nan"), True, False, "1", None, [], 10**400]
)
def test_invalid_setback_values_are_rejected(setback: object) -> None:
    with pytest.raises(InvalidSetback) as error:
        calculate_setback(box(0, 0, 10, 10), setback)

    assert str(error.value)


@pytest.mark.parametrize("setback", [0, 1])
@pytest.mark.parametrize("site", [Polygon(), Polygon([(0, 0), (4, 3), (0, 4), (3, 0)])])
def test_invalid_site_geometry_is_rejected_before_buffering(site: Polygon, setback: float) -> None:
    with pytest.raises(InvalidSiteGeometry):
        calculate_setback(site, setback)


def test_selection_rejects_nonempty_invalid_components() -> None:
    degenerate = Polygon([(0, 0), (1, 0), (2, 0)])

    with pytest.raises(InvalidSiteGeometry):
        select_largest_component([box(0, 0, 2, 2), degenerate])


@pytest.mark.parametrize(
    "candidate",
    [
        pytest.param(box(100, 0, 100.00001, 0.00001), id="entirely-outside"),
        pytest.param(box(1, 1, 9, 9).union(box(9, 4, 100, 4 + 1e-10)), id="long-thin-protrusion"),
    ],
)
def test_invariants_reject_spatial_escape_below_area_tolerance(candidate: Polygon) -> None:
    site = box(0, 0, 10, 10)
    tolerance = area_tolerance_m2(site.area)

    assert candidate.is_valid
    assert not site.covers(candidate)
    assert 0 < candidate.difference(site).area < tolerance
    with pytest.raises(RuntimeError, match="Buildable geometry extends outside the site"):
        _check_invariants(site, candidate, [candidate], tolerance)


@pytest.mark.parametrize(
    "candidate",
    [
        pytest.param(box(1, 1, 9, 9), id="interior"),
        pytest.param(box(0, 0, 10, 10), id="zero-setback"),
        pytest.param(box(0, 2, 5, 8), id="shared-boundary"),
        pytest.param(Polygon([(0, 5), (2, 4), (2, 6)]), id="shared-boundary-point"),
    ],
)
def test_invariants_accept_contained_geometry_and_shared_boundaries(candidate: Polygon) -> None:
    site = box(0, 0, 10, 10)

    assert site.covers(candidate)
    _check_invariants(site, candidate, [candidate], area_tolerance_m2(site.area))
