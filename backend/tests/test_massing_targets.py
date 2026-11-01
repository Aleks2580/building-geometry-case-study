import json
from dataclasses import replace
from pathlib import Path

import pytest
from shapely.geometry import Polygon, box

import app.geometry.footprints as footprints
import app.massing.configurable as configurable
from app.geometry import FootprintLimits, FootprintResult, parse_site_geometry
from app.massing import (
    DesignPreferences,
    DesignTargets,
    FloorLimits,
    FootprintAreaPreferenceResult,
    PreferenceExceedsHardLimit,
    PreferenceMassingResult,
    generate_default_massing,
    generate_massing_with_preferences,
)


def _sample_site(name: str) -> Polygon:
    fixture = Path(__file__).resolve().parents[2] / "data" / "sites" / f"{name}.json"
    vertices = json.loads(fixture.read_text())["polygon"]
    return parse_site_geometry({"type": "Polygon", "coordinates": [[*vertices, vertices[0]]]})


def _floor_limits() -> FloorLimits:
    return FloorLimits(floor_to_floor_m=3.5, max_height_m=24, max_floors=6)


def _generate(
    preferences: DesignPreferences,
    *,
    targets: DesignTargets | None = None,
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
        targets=targets,
    )


def test_no_target_keeps_existing_result_and_reports_not_requested() -> None:
    result = _generate(DesignPreferences())

    assert result.status == "feasible"
    assert result.targets == DesignTargets()
    assert result.target_assessment.gfa_target_m2 is None
    assert result.target_assessment.status == "not_requested"
    assert result.target_assessment.shortfall_m2 is None
    assert result.target_assessment.diagnostic_code is None


def test_zero_target_is_met_for_a_valid_building() -> None:
    result = _generate(DesignPreferences(), targets=DesignTargets(0))

    assert result.status == "feasible"
    assert result.target_assessment.status == "met"
    assert result.target_assessment.shortfall_m2 is None


def test_positive_target_selects_minimum_sufficient_floor_count() -> None:
    result = _generate(DesignPreferences(), targets=DesignTargets(2_000))

    assert result.floor_count == 4
    assert result.gfa_m2 == 2_584
    assert result.status == "feasible"
    assert result.target_assessment.status == "met"


def test_explicit_floor_preference_takes_precedence_when_target_is_unmet() -> None:
    result = _generate(
        DesignPreferences(preferred_floor_count=4),
        targets=DesignTargets(3_000),
    )

    assert result.floor_count == 4
    assert result.gfa_m2 == 2_584
    assert result.status == "feasible_target_unmet"
    assert result.hard_constraints_satisfied is True
    assert result.reason is None
    assert result.target_assessment.status == "unmet"
    assert result.target_assessment.diagnostic_code == "TARGET_UNMET_WITH_PREFERENCES"
    assert result.target_assessment.shortfall_m2 == 416


def test_target_floor_selection_uses_measured_preferred_footprint_area(cross_lobed_site: Polygon) -> None:
    result = _generate(
        DesignPreferences(preferred_footprint_area_m2=150),
        targets=DesignTargets(500),
        site=cross_lobed_site,
        setback_m=0,
        footprint_limits=FootprintLimits(max_footprint_area_m2=150),
        floor_limits=FloorLimits(3.5, max_floors=6),
    )

    assert result.area_preference_result is not None
    assert result.footprint_area_m2 is not None
    assert result.footprint_area_m2 < 150
    assert result.floor_count == 5
    assert result.gfa_m2 == pytest.approx(result.footprint_area_m2 * 5)
    assert result.footprint_area_m2 * 4 < 500 <= result.gfa_m2
    assert result.target_assessment.status == "met"


def test_target_above_hard_upper_bound_is_feasible_but_unmet() -> None:
    result = _generate(DesignPreferences(), targets=DesignTargets(3_900))

    assert result.status == "feasible_target_unmet"
    assert result.hard_constraints_satisfied is True
    assert result.floor_count == 6
    assert result.gfa_m2 == 3_876
    assert result.target_assessment.status == "unmet"
    assert result.target_assessment.diagnostic_code == "TARGET_EXCEEDS_UPPER_BOUND"
    assert result.target_assessment.shortfall_m2 == 24


def test_target_beyond_generated_capacity_is_reported_for_cross_lobed_geometry(cross_lobed_site: Polygon) -> None:
    result = _generate(
        DesignPreferences(preferred_footprint_area_m2=150),
        targets=DesignTargets(260),
        site=cross_lobed_site,
        setback_m=0,
        footprint_limits=FootprintLimits(max_footprint_area_m2=150),
        floor_limits=FloorLimits(3.5, max_floors=2),
    )

    assert result.status == "feasible_target_unmet"
    assert result.default_result.generated_gfa_capacity_m2 is not None
    assert result.default_result.generated_gfa_capacity_m2 < 260 < result.default_result.gfa_upper_bound_m2
    assert result.target_assessment.diagnostic_code == "TARGET_BEYOND_GENERATED_CAPACITY"
    assert result.target_assessment.shortfall_m2 is not None
    assert result.target_assessment.shortfall_m2 > 0


def test_missing_target_is_not_evaluated_without_a_building() -> None:
    result = _generate(
        DesignPreferences(),
        targets=DesignTargets(1_000),
        site=box(0, 0, 10, 10),
        setback_m=5,
    )

    assert result.status == "infeasible"
    assert result.reason == "EMPTY_BUILDABLE_REGION"
    assert result.target_assessment.status == "not_evaluated"
    assert result.target_assessment.shortfall_m2 is None
    assert result.target_assessment.diagnostic_code is None


def test_zero_permitted_floors_precede_target_evaluation() -> None:
    result = _generate(
        DesignPreferences(),
        targets=DesignTargets(1_000),
        site=box(0, 0, 10, 10),
        setback_m=0,
        floor_limits=FloorLimits(3.5, max_height_m=3.49),
    )

    assert result.status == "infeasible"
    assert result.reason == "ZERO_PERMITTED_FLOORS"
    assert result.target_assessment.status == "not_evaluated"
    assert result.target_assessment.diagnostic_code is None


def test_absent_target_is_not_requested_without_a_building() -> None:
    result = _generate(
        DesignPreferences(),
        site=box(0, 0, 10, 10),
        setback_m=5,
    )

    assert result.status == "infeasible"
    assert result.target_assessment.status == "not_requested"
    assert result.target_assessment.gfa_target_m2 is None


def test_invalid_target_object_is_rejected() -> None:
    with pytest.raises(TypeError, match="DesignTargets"):
        generate_massing_with_preferences(
            _sample_site("rectangle"),
            setback_m=3,
            footprint_limits=FootprintLimits(),
            floor_limits=_floor_limits(),
            preferences=DesignPreferences(),
            targets=object(),  # type: ignore[arg-type]
        )


def test_floor_preference_above_capacity_is_rejected_before_preferred_footprint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_if_called(*args: object, **kwargs: object) -> FootprintAreaPreferenceResult:
        raise AssertionError("preferred footprint construction must not run")

    monkeypatch.setattr(configurable, "generate_preferred_footprint", fail_if_called)

    with pytest.raises(PreferenceExceedsHardLimit):
        _generate(
            DesignPreferences(preferred_floor_count=7, preferred_footprint_area_m2=400),
            targets=DesignTargets(1_000),
        )


def test_default_generation_failure_without_preference_has_no_target_assessment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(footprints, "MAX_FOOTPRINT_SEARCH_ITERATIONS", 0)

    result = _generate(
        DesignPreferences(),
        targets=DesignTargets(1_000),
        footprint_limits=FootprintLimits(max_footprint_area_m2=500),
    )

    assert result.status == "generation_failed"
    assert result.reason == "FOOTPRINT_NOT_GENERATED"
    assert result.target_assessment.status == "not_evaluated"
    assert result.gfa_m2 is None


def test_preferred_footprint_failure_has_no_target_assessment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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

    result = _generate(
        DesignPreferences(preferred_footprint_area_m2=400),
        targets=DesignTargets(1_000),
    )

    assert result.status == "generation_failed"
    assert result.reason == "PREFERRED_FOOTPRINT_NOT_GENERATED"
    assert result.target_assessment.status == "not_evaluated"
    assert result.gfa_m2 is None


def test_unknown_generated_capacity_does_not_produce_unsupported_diagnostic(
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

    result = _generate(
        DesignPreferences(preferred_footprint_area_m2=400),
        targets=DesignTargets(3_000),
    )

    assert result.status == "feasible_target_unmet"
    assert result.gfa_m2 == pytest.approx(2_400)
    assert result.default_result.generated_gfa_capacity_m2 is None
    assert result.target_assessment.status == "unmet"
    assert result.target_assessment.diagnostic_code is None
