import copy
import json
from pathlib import Path
from types import MappingProxyType

import pytest
from shapely import from_wkt
from shapely.geometry import LinearRing, MultiPolygon, Point, Polygon, shape

from app.geometry import InvalidSiteGeometry, parse_site_geometry, serialize_site_geometry, site_area_m2

SHELL = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
HOLE = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]


@pytest.mark.parametrize("name, expected_area", [("rectangle", 1000), ("l-shaped", 900), ("notched", 860)])
def test_sample_sites(name: str, expected_area: float) -> None:
    fixture = Path(__file__).resolve().parents[2] / "data" / "sites" / f"{name}.json"
    vertices = json.loads(fixture.read_text())["polygon"]
    ring = [*vertices, vertices[0]]

    polygon = parse_site_geometry({"type": "Polygon", "coordinates": [ring]})

    assert polygon.is_valid
    assert not polygon.is_empty
    assert site_area_m2(polygon) == pytest.approx(expected_area)
    assert polygon.equals(Polygon(ring))
    assert polygon.exterior.is_ccw
    assert not polygon.interiors
    if name != "rectangle":
        assert polygon.area < polygon.convex_hull.area


def test_holes_are_preserved_and_subtracted_from_area() -> None:
    second_hole = [[6, 6], [9, 6], [9, 8], [6, 8], [6, 6]]
    polygon = parse_site_geometry({"type": "Polygon", "coordinates": [SHELL, HOLE, second_hole]})

    assert polygon.is_valid
    assert site_area_m2(polygon) == pytest.approx(100 - 4 - 6)
    assert len(polygon.interiors) == 2
    assert all(not ring.is_ccw for ring in polygon.interiors)
    assert not polygon.covers(Point(3, 3))
    assert not polygon.covers(Point(7, 7))
    assert polygon.covers(Point(5, 5))

    serialized = serialize_site_geometry(polygon)
    assert len(serialized["coordinates"]) == 3
    assert shape(serialized).equals(polygon)
    assert shape(serialized).area == pytest.approx(90)


def test_valid_single_point_hole_contact_follows_geos_topology() -> None:
    touching_hole = [[0, 5], [2, 4], [2, 6], [0, 5]]
    polygon = parse_site_geometry({"type": "Polygon", "coordinates": [SHELL, touching_hole]})

    assert polygon.is_valid
    assert site_area_m2(polygon) == pytest.approx(98)
    assert len(polygon.interiors) == 1


def test_tuple_coordinates_and_mapping_input() -> None:
    value = MappingProxyType({"type": "Polygon", "coordinates": (tuple(tuple(point) for point in SHELL),)})

    polygon = parse_site_geometry(value)

    assert polygon.is_valid
    assert site_area_m2(polygon) == 100


def test_three_distinct_vertices_form_a_valid_triangle() -> None:
    ring = [[0, 0], [3, 0], [0, 2], [0, 0]]
    polygon = parse_site_geometry({"type": "Polygon", "coordinates": [ring]})

    assert polygon.is_valid
    assert site_area_m2(polygon) == 3
    assert len(serialize_site_geometry(polygon)["coordinates"][0]) == 4


@pytest.mark.parametrize(
    "value",
    [
        None,
        [],
        "Polygon",
        {},
        {"type": "Polygon"},
        {"type": "Polygon", "coordinates": None},
        {"type": "Polygon", "coordinates": "invalid"},
        {"type": "Polygon", "coordinates": {}},
        {"type": "Polygon", "coordinates": []},
        {"type": "Polygon", "coordinates": [None]},
        {"type": "Polygon", "coordinates": [[]]},
        {"type": "Polygon", "coordinates": ["invalid"]},
        {"type": "Polygon", "coordinates": SHELL},
    ],
)
def test_rejects_malformed_geometry_structure(value: object) -> None:
    with pytest.raises(InvalidSiteGeometry) as error:
        parse_site_geometry(value)

    assert str(error.value)
    assert error.value.path


@pytest.mark.parametrize(
    "geometry_type", [None, "Point", "LineString", "MultiPolygon", "GeometryCollection", "Feature"]
)
def test_rejects_unsupported_geometry_types(geometry_type: object) -> None:
    with pytest.raises(InvalidSiteGeometry) as error:
        parse_site_geometry({"type": geometry_type, "coordinates": [SHELL]})

    assert error.value.path == "type"


@pytest.mark.parametrize(
    "ring",
    [
        SHELL[:-1],
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 1e-14]],
        [[0, 0], [1, 0], [0, 0]],
        [[0, 0], [1, 0], [0, 0], [1, 0], [0, 0]],
        [[0, 0], [0, 0], [0, 0], [0, 0]],
        [[0, 0], [1, 0], [2, 0], [0, 0]],
        [[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]],
        [[0, 0], [4, 3], [0, 4], [3, 0], [0, 0]],
    ],
)
def test_rejects_open_degenerate_and_self_intersecting_rings(ring: object) -> None:
    with pytest.raises(InvalidSiteGeometry):
        parse_site_geometry({"type": "Polygon", "coordinates": [ring]})


def test_float_conversion_cannot_close_distinct_integer_endpoints() -> None:
    origin = 2**53
    ring = [[origin, 0], [origin + 4, 0], [origin + 4, 4], [origin, 4], [origin + 1, 0]]

    with pytest.raises(InvalidSiteGeometry) as error:
        parse_site_geometry({"type": "Polygon", "coordinates": [ring]})

    assert error.value.path == "coordinates[0]"


@pytest.mark.parametrize(
    "holes",
    [
        [HOLE[:-1]],
        [[[2, 2], [3, 2], [2, 2], [2, 2]]],
        [[[2, 2], [3, 2], [4, 2], [2, 2]]],
        [[[2, 2], [4, 4], [2, 4], [4, 2], [2, 2]]],
        [[[12, 2], [14, 2], [14, 4], [12, 4], [12, 2]]],
        [[[8, 2], [12, 2], [12, 4], [8, 4], [8, 2]]],
        [[[0, 2], [2, 2], [2, 4], [0, 4], [0, 2]]],
        [HOLE, [[3, 3], [5, 3], [5, 5], [3, 5], [3, 3]]],
        [HOLE, [[2.5, 2.5], [3.5, 2.5], [3.5, 3.5], [2.5, 3.5], [2.5, 2.5]]],
    ],
)
def test_rejects_invalid_holes(holes: list[object]) -> None:
    with pytest.raises(InvalidSiteGeometry):
        parse_site_geometry({"type": "Polygon", "coordinates": [SHELL, *holes]})


@pytest.mark.parametrize(
    "point",
    [None, 2, "0,0", {}, [], [0], [0, 0, 0], [False, 0], [0, True], ["0", 0], [0, None]],
)
def test_rejects_malformed_coordinate_pairs(point: object) -> None:
    ring = copy.deepcopy(SHELL)
    ring[2] = point

    with pytest.raises(InvalidSiteGeometry):
        parse_site_geometry({"type": "Polygon", "coordinates": [ring]})


@pytest.mark.parametrize("ordinate", [float("nan"), float("inf"), -float("inf"), 10**400])
@pytest.mark.parametrize("axis", [0, 1])
def test_rejects_non_finite_or_unrepresentable_ordinates(ordinate: float | int, axis: int) -> None:
    ring = copy.deepcopy(SHELL)
    ring[2][axis] = ordinate

    with pytest.raises(InvalidSiteGeometry) as error:
        parse_site_geometry({"type": "Polygon", "coordinates": [ring]})

    assert error.value.path == f"coordinates[0][2][{axis}]"


def test_rejects_non_finite_area_from_finite_coordinates() -> None:
    ring = [[0, 0], [1e200, 0], [1e200, 1e200], [0, 1e200], [0, 0]]

    with pytest.raises(InvalidSiteGeometry):
        parse_site_geometry({"type": "Polygon", "coordinates": [ring]})


def test_positive_area_is_not_subject_to_a_minimum_size_tolerance() -> None:
    ring = [[0, 0], [1e-6, 0], [1e-6, 1e-6], [0, 1e-6], [0, 0]]
    polygon = parse_site_geometry({"type": "Polygon", "coordinates": [ring]})

    assert polygon.is_valid
    assert site_area_m2(polygon) == pytest.approx(1e-12, rel=1e-12, abs=0)
    assert site_area_m2(polygon) > 0


def test_normalization_is_deterministic_across_ring_start_direction_and_hole_order() -> None:
    second_hole = [[6, 6], [8, 6], [8, 8], [6, 8], [6, 6]]
    expected = serialize_site_geometry(
        parse_site_geometry({"type": "Polygon", "coordinates": [SHELL, HOLE, second_hole]})
    )

    for offset in range(len(SHELL) - 1):
        vertices = SHELL[:-1]
        rotated = vertices[offset:] + vertices[:offset]
        for shell in [rotated + [rotated[0]], list(reversed(rotated + [rotated[0]]))]:
            for holes in [[HOLE, second_hole], [list(reversed(second_hole)), list(reversed(HOLE))]]:
                polygon = parse_site_geometry({"type": "Polygon", "coordinates": [shell, *holes]})
                assert serialize_site_geometry(polygon) == expected
                assert site_area_m2(polygon) == 92

    assert serialize_site_geometry(Polygon(list(reversed(SHELL)), [second_hole, HOLE])) == expected
    assert LinearRing(expected["coordinates"][0]).is_ccw
    assert all(not LinearRing(ring).is_ccw for ring in expected["coordinates"][1:])


@pytest.mark.parametrize("ring_index", [0, 1])
def test_consecutive_duplicates_are_canonical_across_rotations_and_round_trips(ring_index: int) -> None:
    original = Polygon(SHELL, [HOLE])
    expected = serialize_site_geometry(original)
    vertices = [SHELL, HOLE][ring_index][:-1]
    vertices.insert(0, vertices[0])

    for offset in range(len(vertices)):
        rotated = vertices[offset:] + vertices[:offset]
        closed = rotated + [rotated[0]]
        for ring in [closed, list(reversed(closed))]:
            coordinates = copy.deepcopy([SHELL, HOLE])
            coordinates[ring_index] = ring
            direct = Polygon(coordinates[0], coordinates[1:])
            polygon = parse_site_geometry({"type": "Polygon", "coordinates": coordinates})
            serialized = serialize_site_geometry(polygon)
            restored = parse_site_geometry(json.loads(json.dumps(serialized, allow_nan=False)))

            assert polygon.is_valid
            assert polygon.equals(original)
            assert site_area_m2(polygon) == original.area == 96
            assert len(polygon.interiors) == 1
            assert serialized == serialize_site_geometry(direct) == expected
            assert restored.equals_exact(polygon, tolerance=0)
            assert serialize_site_geometry(restored) == serialized


def test_duplicate_removal_preserves_every_distinct_coordinate() -> None:
    shell = [[0, 0], [0, 0], [1e-170, 0], [5, 0], *SHELL[1:]]
    hole = [[2, 2], [2, 2], [2.000000000000001, 2], [3, 2], *HOLE[1:]]
    original = Polygon(shell, [hole])
    polygon = parse_site_geometry({"type": "Polygon", "coordinates": [shell, hole]})
    serialized = serialize_site_geometry(polygon)

    assert polygon.is_valid
    assert polygon.equals(original)
    assert site_area_m2(polygon) == original.area == 96
    for actual, supplied in zip(serialized["coordinates"], [shell, hole], strict=True):
        expected_vertices = {tuple(position) for position in supplied}
        assert {tuple(position) for position in actual} == expected_vertices
        assert len(actual) == len(expected_vertices) + 1


def test_serialization_round_trip_preserves_float_coordinates_topology_and_area() -> None:
    shell = [
        [0.1234567890123456, -2.987654321098765],
        [10.123456789012344, -2.987654321098765],
        [10.123456789012344, 7.012345678901234],
        [0.1234567890123456, 7.012345678901234],
        [0.1234567890123456, -2.987654321098765],
    ]
    original = {"type": "Polygon", "coordinates": [shell, HOLE]}
    unchanged = copy.deepcopy(original)
    polygon = parse_site_geometry(original)
    serialized = serialize_site_geometry(polygon)
    restored = parse_site_geometry(json.loads(json.dumps(serialized, allow_nan=False)))

    assert original == unchanged
    assert restored.is_valid
    assert restored.equals(polygon)
    assert restored.equals_exact(polygon, tolerance=0)
    assert site_area_m2(restored) == site_area_m2(polygon)
    assert serialize_site_geometry(restored) == serialized
    for ring in serialized["coordinates"]:
        assert isinstance(ring, list)
        assert ring[0] == ring[-1]
        assert all(isinstance(point, list) and len(point) == 2 for point in ring)
    assert {tuple(point) for point in serialized["coordinates"][0]} == {tuple(point) for point in shell}

    serialized["coordinates"][0][0][0] = 999
    assert site_area_m2(polygon) == site_area_m2(restored)
    assert serialize_site_geometry(polygon) != serialized


def test_serialization_normalizes_signed_zero_even_for_direct_shapely_input() -> None:
    polygon = Polygon([[-0.0, -0.0], [10, -0.0], [10, 10], [-0.0, 10], [-0.0, -0.0]])
    serialized = serialize_site_geometry(polygon)
    round_trip = serialize_site_geometry(parse_site_geometry(serialized))

    assert json.dumps(serialized) == json.dumps(round_trip)
    assert json.dumps(serialized) == json.dumps(serialize_site_geometry(Polygon(SHELL)))


@pytest.mark.parametrize("operation", [serialize_site_geometry, site_area_m2])
@pytest.mark.parametrize(
    "polygon",
    [
        None,
        Point(0, 0),
        MultiPolygon([Polygon(SHELL)]),
        Polygon(),
        Polygon([(0, 0), (1, 0), (2, 0)]),
        Polygon([(0, 0), (4, 3), (0, 4), (3, 0)]),
        Polygon([(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 0, 1)]),
        from_wkt("POLYGON M ((0 0 1, 1 0 1, 1 1 1, 0 0 1))"),
        Polygon([(0, 0), (1e200, 0), (1e200, 1e200), (0, 1e200)]),
    ],
)
def test_public_operations_reject_invalid_site_polygons(operation, polygon: object) -> None:
    with pytest.raises(InvalidSiteGeometry):
        operation(polygon)
