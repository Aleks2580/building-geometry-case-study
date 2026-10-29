import json
from pathlib import Path

import pytest
from shapely.geometry import Polygon, box

from app.geometry import (
    FootprintLimits,
    InvalidFootprintLimits,
    calculate_footprint_area_upper_bound,
    calculate_setback,
    parse_site_geometry,
)


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
