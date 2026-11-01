import json
from dataclasses import replace
from pathlib import Path

import pytest
from shapely.errors import GEOSException
from shapely.geometry import Polygon, box

import app.geometry.footprints as footprints
import app.massing.configurable as configurable
from app.geometry import FootprintLimits, FootprintResult, parse_site_geometry
from app.massing import (
    DesignPreferences,
    FloorLimits,
    FootprintAreaPreferenceResult,
    InvalidDesignPreferences,
    NumericalRangeError,
    PreferenceExceedsHardLimit,
    PreferenceMassingResult,
    generate_default_massing,
    generate_massing_with_preferences,
)


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


def _generate(
    preferences: DesignPreferences,
    *,
    site: Polygon | None = None,
    setback_m: float = 3,
    footprint_limits: FootprintLimits | None = None,
    floor_limits: FloorLimits | None = None,
) -> PreferenceMassingResult:
    return generate_massing_with_preferences(
        site if site is not None else _sample_site("rectangle"),
        setback_m=setback_m,
        footprint_limits=footprint_limits or FootprintLimits(),
        floor_limits=floor_limits or _floor_limits(),
        preferences=preferences,
    )


def test_no_preferences_match_default_without_preferred_construction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected = generate_default_massing(
        _sample_site("rectangle"),
        setback_m=3,
        footprint_limits=FootprintLimits(),
        floor_limits=_floor_limits(),
    )

    def fail_if_called(*args: object, **kwargs: object) -> FootprintAreaPreferenceResult:
        raise AssertionError("preferred footprint construction must be skipped")

    monkeypatch.setattr(configurable, "generate_preferred_footprint", fail_if_called)
    result = _generate(DesignPreferences())

    assert result.area_preference_result is None
    assert result.default_result is not expected
    assert result.footprint_geometry.equals(expected.footprint_geometry)
    assert result.floor_plate_geometry is result.footprint_geometry
    assert result.footprint_area_m2 == expected.footprint_area_m2
    assert result.floor_count == expected.floor_count
    assert result.height_m == expected.height_m
    assert result.gfa_m2 == expected.gfa_m2
    assert result.site_coverage_ratio == expected.site_coverage_ratio
    assert result.status == expected.status
    assert result.reason == expected.reason
    assert result.hard_constraints_satisfied == expected.hard_constraints_satisfied


def test_floor_preference_changes_actual_metrics_but_not_default_capacity() -> None:
    result = _generate(DesignPreferences(preferred_floor_count=4))

    assert result.status == "feasible"
    assert result.floor_count == 4
    assert result.footprint_area_m2 == 646
    assert result.height_m == 14
    assert result.gfa_m2 == 2584
    assert result.default_result.maximum_permitted_floor_count == 6
    assert result.default_result.footprint_area_upper_bound_m2 == 646
    assert result.default_result.gfa_upper_bound_m2 == 3876
    assert result.default_result.generated_gfa_capacity_m2 == 3876


def test_area_preference_uses_measured_geometry_for_actual_gfa() -> None:
    result = _generate(DesignPreferences(preferred_footprint_area_m2=400))

    assert result.status == "feasible"
    assert result.floor_count == 6
    assert result.area_preference_result is not None
    assert result.area_preference_result.status == "met"
    assert result.footprint_geometry is not None
    assert result.footprint_geometry.is_valid
    assert result.default_result.gfa_upper_bound_m2 == 3876
    assert result.default_result.generated_gfa_capacity_m2 == 3876
    assert result.footprint_area_m2 == pytest.approx(result.footprint_geometry.area)
    assert result.gfa_m2 == pytest.approx(result.footprint_area_m2 * 6)
    assert result.gfa_m2 < result.default_result.generated_gfa_capacity_m2


def test_both_preferences_apply_to_one_actual_building() -> None:
    result = _generate(
        DesignPreferences(preferred_floor_count=4, preferred_footprint_area_m2=400),
    )

    assert result.status == "feasible"
    assert result.floor_count == 4
    assert result.height_m == 14
    assert result.footprint_geometry is not None
    assert result.default_result.setback_result.selected_buildable_geometry.covers(result.footprint_geometry)
    assert result.footprint_area_m2 == pytest.approx(result.footprint_geometry.area)
    assert result.gfa_m2 == pytest.approx(result.footprint_area_m2 * 4)
    assert result.site_coverage_ratio is not None
    assert result.default_result.site_coverage_ratio is not None
    assert result.site_coverage_ratio == pytest.approx(
        result.footprint_area_m2 / result.default_result.setback_result.site_area_m2,
    )
    assert result.site_coverage_ratio < result.default_result.site_coverage_ratio


def test_clamped_area_preference_keeps_default_bounds_and_is_feasible() -> None:
    result = _generate(
        DesignPreferences(preferred_footprint_area_m2=600),
        footprint_limits=FootprintLimits(max_footprint_area_m2=500),
    )

    assert result.status == "feasible"
    assert result.hard_constraints_satisfied is True
    assert result.area_preference_result is not None
    assert result.area_preference_result.status == "clamped"
    assert result.area_preference_result.effective_target_m2 == 500
    assert result.footprint_area_m2 is not None and result.footprint_area_m2 <= 500
    assert result.default_result.footprint_area_upper_bound_m2 == 500
    assert result.default_result.gfa_upper_bound_m2 == 3000
    assert result.default_result.generated_gfa_capacity_m2 == pytest.approx(3000)
    assert result.area_preference_result.diagnostic_codes == ("PREFERENCE_CLAMPED_TO_HARD_CAP",)


def test_dumbbell_preference_reaches_requested_area_with_clipping() -> None:
    result = _generate(
        DesignPreferences(preferred_footprint_area_m2=350),
        site=_dumbbell_site(),
        setback_m=0,
        footprint_limits=FootprintLimits(max_footprint_area_m2=350),
        floor_limits=FloorLimits(3.5, max_floors=2),
    )

    assert result.status == "feasible"
    assert result.area_preference_result is not None
    assert result.area_preference_result.status == "met"
    assert result.footprint_area_m2 is not None and result.footprint_area_m2 <= 350
    assert result.footprint_area_m2 == pytest.approx(350)
    assert result.gfa_m2 == pytest.approx(result.footprint_area_m2 * 2)
    assert result.default_result.gfa_upper_bound_m2 == 700
    assert result.default_result.generated_gfa_capacity_m2 == pytest.approx(result.footprint_area_m2 * 2)
    assert result.area_preference_result.diagnostic_codes == ()
    assert result.area_preference_result.footprint_result.secondary_component_count == 1
    assert result.area_preference_result.footprint_result.secondary_discarded_area_m2 == 0
    assert result.footprint_geometry is not None and result.footprint_geometry.is_valid
    assert result.default_result.setback_result.selected_buildable_geometry.covers(result.footprint_geometry)


@pytest.mark.parametrize("with_area_preference", [False, True])
def test_floor_preference_above_capacity_is_rejected_before_area_construction(
    monkeypatch: pytest.MonkeyPatch,
    with_area_preference: bool,
) -> None:
    def fail_if_called(*args: object, **kwargs: object) -> FootprintAreaPreferenceResult:
        raise AssertionError("preferred footprint construction must not run")

    monkeypatch.setattr(configurable, "generate_preferred_footprint", fail_if_called)
    preferences = DesignPreferences(
        preferred_floor_count=7,
        preferred_footprint_area_m2=400 if with_area_preference else None,
    )

    with pytest.raises(PreferenceExceedsHardLimit):
        _generate(preferences)


@pytest.mark.parametrize(
    ("site", "setback_m", "floor_limits", "expected_reason"),
    [
        (box(0, 0, 10, 10), 5, _floor_limits(), "EMPTY_BUILDABLE_REGION"),
        (box(0, 0, 10, 10), 0, FloorLimits(3.5, max_height_m=3.49), "ZERO_PERMITTED_FLOORS"),
        (box(0, 0, 10, 10), 5, FloorLimits(3.5, max_height_m=3.49), "EMPTY_BUILDABLE_REGION"),
    ],
)
def test_hard_infeasibility_precedes_preferences(
    monkeypatch: pytest.MonkeyPatch,
    site: Polygon,
    setback_m: float,
    floor_limits: FloorLimits,
    expected_reason: str,
) -> None:
    def fail_if_called(*args: object, **kwargs: object) -> FootprintAreaPreferenceResult:
        raise AssertionError("preferred footprint construction must be skipped")

    monkeypatch.setattr(configurable, "generate_preferred_footprint", fail_if_called)
    result = _generate(
        DesignPreferences(preferred_floor_count=1, preferred_footprint_area_m2=100),
        site=site,
        setback_m=setback_m,
        floor_limits=floor_limits,
    )

    assert result.status == "infeasible"
    assert result.reason == expected_reason
    assert result.hard_constraints_satisfied is False
    assert result.area_preference_result is None
    assert result.footprint_geometry is None
    assert result.floor_plate_geometry is None
    assert result.footprint_area_m2 is None
    assert result.floor_count is None
    assert result.height_m is None
    assert result.gfa_m2 is None
    assert result.site_coverage_ratio is None


def test_failed_preferred_construction_preserves_default_context(monkeypatch: pytest.MonkeyPatch) -> None:
    failed_footprint = FootprintResult(
        footprint_area_upper_bound_m2=400,
        generated_footprint_geometry=None,
        generated_footprint_area_m2=None,
        outcome="generation_failed",
        secondary_component_count=0,
        secondary_discarded_area_m2=0,
        undershoot_m2=None,
    )
    failed_preference = FootprintAreaPreferenceResult(
        original_hard_area_upper_bound_m2=646,
        requested_area_m2=400,
        effective_target_m2=400,
        actual_area_m2=None,
        difference_m2=None,
        effective_target_undershoot_m2=None,
        status="unmet",
        footprint_result=failed_footprint,
        diagnostic_codes=("PREFERRED_FOOTPRINT_NOT_GENERATED",),
    )
    monkeypatch.setattr(configurable, "generate_preferred_footprint", lambda *args, **kwargs: failed_preference)
    result = _generate(DesignPreferences(preferred_footprint_area_m2=400))

    assert result.status == "generation_failed"
    assert result.reason == "PREFERRED_FOOTPRINT_NOT_GENERATED"
    assert result.hard_constraints_satisfied is None
    assert result.area_preference_result is failed_preference
    assert result.default_result.status == "feasible"
    assert result.default_result.generated_gfa_capacity_m2 == 3876
    assert result.footprint_geometry is None
    assert result.gfa_m2 is None


def test_default_generation_failure_without_area_preference_preserves_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(footprints, "MAX_FOOTPRINT_SEARCH_ITERATIONS", 0)

    result = _generate(
        DesignPreferences(),
        footprint_limits=FootprintLimits(max_footprint_area_m2=500),
    )

    assert result.status == "generation_failed"
    assert result.reason == "FOOTPRINT_NOT_GENERATED"
    assert result.hard_constraints_satisfied is None
    assert result.area_preference_result is None
    assert result.default_result.status == "generation_failed"
    assert result.default_result.reason == "FOOTPRINT_NOT_GENERATED"
    assert result.default_result.footprint_area_upper_bound_m2 == 500
    assert result.default_result.gfa_upper_bound_m2 == 3000
    assert result.footprint_geometry is None
    assert result.floor_plate_geometry is None
    assert result.footprint_area_m2 is None
    assert result.floor_count is None
    assert result.height_m is None
    assert result.gfa_m2 is None
    assert result.site_coverage_ratio is None


def test_default_generation_failure_does_not_block_successful_preferred_construction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    successful_default = generate_default_massing(
        _sample_site("rectangle"),
        setback_m=3,
        footprint_limits=FootprintLimits(),
        floor_limits=_floor_limits(),
    )
    failed_default = replace(
        successful_default,
        footprint_result=FootprintResult(
            footprint_area_upper_bound_m2=646,
            generated_footprint_geometry=None,
            generated_footprint_area_m2=None,
            outcome="generation_failed",
            secondary_component_count=0,
            secondary_discarded_area_m2=0,
            undershoot_m2=None,
        ),
        generated_footprint_geometry=None,
        generated_footprint_area_m2=None,
        generated_gfa_capacity_m2=None,
        footprint_geometry=None,
        floor_plate_geometry=None,
        footprint_area_m2=None,
        floor_count=None,
        height_m=None,
        gfa_m2=None,
        site_coverage_ratio=None,
        status="generation_failed",
        hard_constraints_satisfied=None,
        reason="FOOTPRINT_NOT_GENERATED",
    )
    monkeypatch.setattr(configurable, "generate_default_massing", lambda *args, **kwargs: failed_default)

    result = _generate(DesignPreferences(preferred_footprint_area_m2=400))

    assert result.status == "feasible"
    assert result.reason is None
    assert result.hard_constraints_satisfied is True
    assert result.default_result.status == "generation_failed"
    assert result.default_result.generated_gfa_capacity_m2 is None
    assert result.area_preference_result is not None
    assert result.area_preference_result.status == "met"
    assert result.footprint_geometry is not None
    assert result.footprint_area_m2 == pytest.approx(result.footprint_geometry.area)
    assert result.gfa_m2 == pytest.approx(result.footprint_area_m2 * 6)


def test_holed_and_split_preferred_geometry_preserves_context() -> None:
    holed_site = Polygon(box(0, 0, 20, 20).exterior.coords, [box(8, 8, 12, 12).exterior.coords])
    holed_result = _generate(
        DesignPreferences(preferred_footprint_area_m2=100),
        site=holed_site,
        setback_m=2,
        floor_limits=FloorLimits(3.5, max_floors=2),
    )
    assert holed_result.footprint_geometry is not None
    assert len(holed_result.footprint_geometry.interiors) == 1
    assert holed_result.default_result.setback_result.selected_buildable_geometry.covers(
        holed_result.footprint_geometry,
    )

    split_result = _generate(
        DesignPreferences(preferred_footprint_area_m2=100),
        site=_sample_site("notched"),
        setback_m=3,
        floor_limits=FloorLimits(3.5, max_floors=2),
    )
    assert split_result.footprint_geometry is not None
    assert split_result.default_result.setback_result.component_count == 2
    assert split_result.default_result.setback_result.selected_buildable_geometry.covers(
        split_result.footprint_geometry,
    )


def test_stored_float_height_boundary_is_preserved() -> None:
    result = _generate(
        DesignPreferences(preferred_floor_count=9),
        floor_limits=FloorLimits(3.6, max_height_m=36.0),
    )

    assert result.status == "feasible"
    assert result.floor_count == 9
    assert result.height_m == 32.4


def test_large_integer_floor_count_keeps_finite_preferred_metrics() -> None:
    floor_count = 2**1074
    result = _generate(
        DesignPreferences(preferred_floor_count=floor_count),
        site=box(0, 0, 1e-160, 1e-160),
        setback_m=0,
        floor_limits=FloorLimits(5e-324, max_floors=floor_count),
    )

    assert result.status == "feasible"
    assert result.floor_count == floor_count
    assert result.height_m == 1.0
    assert result.gfa_m2 == 2024.0


def test_unrepresentable_derived_metric_raises_numerical_range_error() -> None:
    with pytest.raises(NumericalRangeError, match="gfa_upper_bound_m2"):
        _generate(
            DesignPreferences(),
            site=box(0, 0, 1, 1),
            setback_m=0,
            floor_limits=FloorLimits(3.5, max_floors=10**400),
        )


def test_unexpected_geometry_error_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_geos_error(*args: object, **kwargs: object) -> Polygon:
        raise GEOSException("synthetic configurable massing failure")

    monkeypatch.setattr(Polygon, "buffer", raise_geos_error)

    with pytest.raises(GEOSException, match="synthetic configurable massing failure"):
        _generate(DesignPreferences(preferred_footprint_area_m2=400), setback_m=0)


def test_invalid_preferences_type_is_rejected() -> None:
    with pytest.raises(InvalidDesignPreferences, match="DesignPreferences"):
        generate_massing_with_preferences(
            _sample_site("rectangle"),
            setback_m=3,
            footprint_limits=FootprintLimits(),
            floor_limits=_floor_limits(),
            preferences=object(),  # type: ignore[arg-type]
        )


def test_preference_massing_result_is_immutable() -> None:
    result = _generate(DesignPreferences(preferred_floor_count=4))

    with pytest.raises(AttributeError):
        result.status = "infeasible"  # type: ignore[misc]
