import json
import math
from pathlib import Path

import pytest
from shapely.errors import GEOSException
from shapely.geometry import Polygon, box

import app.massing.area_preferences as area_preferences
from app.geometry import FootprintLimits, FootprintResult, calculate_setback, parse_site_geometry
from app.geometry.tolerances import area_tolerance_m2
from app.massing import (
    DesignPreferences,
    FootprintAreaPreferenceResult,
    InvalidDesignPreferences,
    generate_preferred_footprint,
)


def _sample_site(name: str) -> Polygon:
    fixture = Path(__file__).resolve().parents[2] / "data" / "sites" / f"{name}.json"
    vertices = json.loads(fixture.read_text())["polygon"]
    return parse_site_geometry({"type": "Polygon", "coordinates": [[*vertices, vertices[0]]]})


def test_no_area_preference_returns_none_without_constructing(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_if_called(*args: object, **kwargs: object) -> FootprintResult:
        raise AssertionError("preferred footprint construction must be skipped")

    monkeypatch.setattr(area_preferences, "generate_footprint", fail_if_called)
    setback = calculate_setback(_sample_site("rectangle"), 3)

    assert generate_preferred_footprint(setback, FootprintLimits(), DesignPreferences()) is None
    assert (
        generate_preferred_footprint(
            setback,
            FootprintLimits(),
            DesignPreferences(preferred_floor_count=4),
        )
        is None
    )


def test_ordinary_request_reuses_generator_and_reports_measured_area() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 3)
    result = generate_preferred_footprint(
        setback,
        FootprintLimits(),
        DesignPreferences(preferred_footprint_area_m2=400),
    )

    assert isinstance(result, FootprintAreaPreferenceResult)
    assert result.original_hard_area_upper_bound_m2 == 646
    assert result.requested_area_m2 == 400
    assert result.effective_target_m2 == 400
    assert result.actual_area_m2 is not None and result.actual_area_m2 <= result.effective_target_m2
    assert result.actual_area_m2 == pytest.approx(result.footprint_result.generated_footprint_geometry.area)
    assert result.difference_m2 == pytest.approx(result.actual_area_m2 - result.requested_area_m2)
    assert result.effective_target_undershoot_m2 is None
    assert result.status == "met"
    assert result.diagnostic_codes == ()
    assert result.footprint_result.secondary_component_count == 1
    assert setback.selected_buildable_geometry.covers(result.footprint_result.generated_footprint_geometry)


def test_request_above_original_hard_cap_is_clamped() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 3)
    result = generate_preferred_footprint(
        setback,
        FootprintLimits(max_footprint_area_m2=500),
        DesignPreferences(preferred_footprint_area_m2=600),
    )

    assert result is not None
    assert result.original_hard_area_upper_bound_m2 == 500
    assert result.requested_area_m2 == 600
    assert result.effective_target_m2 == 500
    assert result.actual_area_m2 is not None and result.actual_area_m2 <= 500
    assert result.difference_m2 == pytest.approx(result.actual_area_m2 - 600)
    assert result.effective_target_undershoot_m2 == pytest.approx(500 - result.actual_area_m2)
    assert result.status == "clamped"
    assert result.diagnostic_codes == ("PREFERENCE_CLAMPED_TO_HARD_CAP",)


def test_hard_cap_equality_and_tolerance_boundary() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 3)
    upper_bound = setback.selected_buildable_area_m2
    tolerance = area_tolerance_m2(setback.site_area_m2)

    equal = generate_preferred_footprint(
        setback,
        FootprintLimits(),
        DesignPreferences(preferred_footprint_area_m2=upper_bound),
    )
    immediately_above = math.nextafter(upper_bound, math.inf)
    boundary = generate_preferred_footprint(
        setback,
        FootprintLimits(),
        DesignPreferences(preferred_footprint_area_m2=immediately_above),
    )
    materially_above = upper_bound + max(1.0, tolerance * 2)
    clamped = generate_preferred_footprint(
        setback,
        FootprintLimits(),
        DesignPreferences(preferred_footprint_area_m2=materially_above),
    )

    assert equal is not None
    assert equal.requested_area_m2 == upper_bound
    assert equal.effective_target_m2 == upper_bound
    assert equal.actual_area_m2 is not None and equal.actual_area_m2 <= upper_bound
    assert equal.status == "met"
    assert equal.diagnostic_codes == ()

    assert immediately_above > upper_bound
    assert 0 < immediately_above - upper_bound < tolerance
    assert boundary is not None
    assert boundary.effective_target_m2 == upper_bound
    assert boundary.actual_area_m2 is not None and boundary.actual_area_m2 <= upper_bound
    assert "PREFERENCE_CLAMPED_TO_HARD_CAP" not in boundary.diagnostic_codes
    assert boundary.status == "met"

    assert materially_above - upper_bound > tolerance
    assert clamped is not None
    assert clamped.effective_target_m2 == upper_bound
    assert clamped.actual_area_m2 is not None and clamped.actual_area_m2 <= upper_bound
    assert clamped.status == "clamped"
    assert clamped.diagnostic_codes == ("PREFERENCE_CLAMPED_TO_HARD_CAP",)


def test_heuristic_undershoot_is_approximation_and_preserves_components(cross_lobed_site: Polygon) -> None:
    setback = calculate_setback(cross_lobed_site, 0)
    result = generate_preferred_footprint(
        setback,
        FootprintLimits(max_footprint_area_m2=150),
        DesignPreferences(preferred_footprint_area_m2=150),
    )

    assert result is not None
    assert result.original_hard_area_upper_bound_m2 == 150
    assert result.actual_area_m2 is not None and result.actual_area_m2 < 150
    assert result.status == "approximated"
    assert result.diagnostic_codes == ("FOOTPRINT_AREA_APPROXIMATED",)
    assert result.footprint_result.secondary_component_count == 2
    assert result.footprint_result.secondary_discarded_area_m2 > 0


def test_clamped_request_preserves_heuristic_undershoot(cross_lobed_site: Polygon) -> None:
    setback = calculate_setback(cross_lobed_site, 0)
    result = generate_preferred_footprint(
        setback,
        FootprintLimits(max_footprint_area_m2=150),
        DesignPreferences(preferred_footprint_area_m2=200),
    )

    assert result is not None
    assert result.original_hard_area_upper_bound_m2 == 150
    assert result.requested_area_m2 == 200
    assert result.effective_target_m2 == 150
    geometry = result.footprint_result.generated_footprint_geometry
    assert geometry is not None and geometry.is_valid and geometry.area > 0
    assert setback.selected_buildable_geometry.covers(geometry)
    assert result.actual_area_m2 is not None and result.actual_area_m2 < 150
    assert result.effective_target_undershoot_m2 is not None
    assert result.effective_target_undershoot_m2 > area_tolerance_m2(setback.site_area_m2)
    assert result.difference_m2 == pytest.approx(result.actual_area_m2 - 200)
    assert result.status == "clamped"
    assert result.diagnostic_codes == (
        "PREFERENCE_CLAMPED_TO_HARD_CAP",
        "FOOTPRINT_AREA_APPROXIMATED",
    )
    assert result.footprint_result.secondary_component_count == 2
    assert result.footprint_result.secondary_discarded_area_m2 > 0


def test_holes_and_split_setbacks_stay_in_selected_component() -> None:
    holed_site = Polygon(box(0, 0, 20, 20).exterior.coords, [box(8, 8, 12, 12).exterior.coords])
    holed_setback = calculate_setback(holed_site, 2)
    holed_result = generate_preferred_footprint(
        holed_setback,
        FootprintLimits(),
        DesignPreferences(preferred_footprint_area_m2=100),
    )

    assert holed_result is not None
    holed_geometry = holed_result.footprint_result.generated_footprint_geometry
    assert holed_geometry is not None and len(holed_geometry.interiors) == 1
    assert holed_setback.selected_buildable_geometry.covers(holed_geometry)
    assert holed_geometry.area == pytest.approx(holed_result.actual_area_m2)

    split_setback = calculate_setback(_sample_site("notched"), 3)
    split_result = generate_preferred_footprint(
        split_setback,
        FootprintLimits(),
        DesignPreferences(preferred_footprint_area_m2=100),
    )

    assert split_result is not None
    split_geometry = split_result.footprint_result.generated_footprint_geometry
    assert split_geometry is not None
    assert split_setback.selected_buildable_geometry.covers(split_geometry)
    assert split_setback.component_count == 2
    assert split_result.footprint_result.secondary_component_count == 1


def test_tiny_positive_request_is_not_rejected_as_zero() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 3)
    result = generate_preferred_footprint(
        setback,
        FootprintLimits(),
        DesignPreferences(preferred_footprint_area_m2=math.nextafter(0.0, 1.0)),
    )

    assert result is not None
    assert result.requested_area_m2 > 0
    assert result.effective_target_m2 > 0
    assert result.status == "unmet"
    assert result.actual_area_m2 is None
    assert result.difference_m2 is None
    assert result.diagnostic_codes == ("PREFERRED_FOOTPRINT_NOT_GENERATED",)


def test_generation_failure_preserves_attempted_result_without_default_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempted = FootprintResult(
        footprint_area_upper_bound_m2=400,
        generated_footprint_geometry=None,
        generated_footprint_area_m2=None,
        outcome="generation_failed",
        secondary_component_count=0,
        secondary_discarded_area_m2=0,
        undershoot_m2=None,
    )
    monkeypatch.setattr(area_preferences, "generate_footprint", lambda *args, **kwargs: attempted)
    setback = calculate_setback(_sample_site("rectangle"), 3)
    result = generate_preferred_footprint(
        setback,
        FootprintLimits(),
        DesignPreferences(preferred_footprint_area_m2=400),
    )

    assert result is not None
    assert result.status == "unmet"
    assert result.footprint_result is attempted
    assert result.actual_area_m2 is None
    assert result.difference_m2 is None
    assert result.diagnostic_codes == ("PREFERRED_FOOTPRINT_NOT_GENERATED",)


def test_unexpected_geometry_errors_propagate(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_geos_error(*args: object, **kwargs: object) -> FootprintResult:
        raise GEOSException("synthetic preferred footprint failure")

    monkeypatch.setattr(area_preferences, "generate_footprint", raise_geos_error)
    setback = calculate_setback(_sample_site("rectangle"), 3)

    with pytest.raises(GEOSException, match="synthetic preferred footprint failure"):
        generate_preferred_footprint(
            setback,
            FootprintLimits(),
            DesignPreferences(preferred_footprint_area_m2=400),
        )


def test_invalid_preference_object_type_is_rejected() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 3)

    with pytest.raises(InvalidDesignPreferences, match="DesignPreferences"):
        generate_preferred_footprint(setback, FootprintLimits(), object())  # type: ignore[arg-type]


def test_positive_preference_requires_positive_selected_region() -> None:
    setback = calculate_setback(box(0, 0, 10, 10), 5)

    with pytest.raises(ValueError, match="positive selected buildable region"):
        generate_preferred_footprint(
            setback,
            FootprintLimits(),
            DesignPreferences(preferred_footprint_area_m2=1),
        )


def test_preference_result_is_immutable_and_has_only_canonical_fields() -> None:
    setback = calculate_setback(_sample_site("rectangle"), 3)
    result = generate_preferred_footprint(
        setback,
        FootprintLimits(),
        DesignPreferences(preferred_footprint_area_m2=400),
    )

    assert result is not None
    with pytest.raises(AttributeError):
        result.status = "unmet"  # type: ignore[misc]
    for alias in (
        "original_footprint_area_upper_bound_m2",
        "requested_footprint_area_m2",
        "effective_footprint_area_m2",
        "actual_footprint_area_m2",
        "preferred_footprint_result",
        "preference_status",
        "diagnostics",
    ):
        assert not hasattr(result, alias)
